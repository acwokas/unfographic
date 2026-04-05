const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a precision layout analysis engine. You deconstruct infographic images into editable PowerPoint components.

APPROACH:
1. The ENTIRE original image becomes a full-slide background
2. You extract every visible text string as a positioned text overlay
3. Users can then edit, move, or delete any text in PowerPoint

YOUR TASK:
Given an image of dimensions IMAGE_WIDTH × IMAGE_HEIGHT pixels, identify every text element and return its PIXEL-BASED bounding box.

RULES FOR TEXT EXTRACTION:

1. BOUNDING BOXES IN PIXELS:
   - Return x, y, w, h in PIXELS relative to the original image dimensions
   - x = pixels from left edge to the LEFT side of the text
   - y = pixels from top edge to the TOP of the text
   - w = pixel width of the text block
   - h = pixel height of the text block
   - Be PRECISE — the text box must sit exactly over the text in the image

2. TEXT GROUPING:
   - Keep headings and their subtitles as SEPARATE elements
   - Keep labels (like "CRM", "DSPs") as individual elements
   - Group a description paragraph as one element
   - Each bullet point is a separate element

3. FONT SIZE ESTIMATION:
   - Measure the approximate cap-height of the text in pixels
   - Return this as fontSizePx — we will convert to points later
   - Title text is usually 30-50px cap height
   - Body text is usually 12-20px cap height
   - Small labels are usually 10-14px cap height

4. VISUAL PROPERTIES:
   - fontColor: hex color WITHOUT # prefix (e.g. "FFFFFF")
   - bold: true for headings and emphasized text
   - align: "left", "center", or "right"

5. ELEMENT ORDER:
   - Top to bottom, left to right
   - Titles first, then section headers, then body text, then captions

6. BACKGROUND COLOR DETECTION:
   - For each text element, identify the dominant colour of the area DIRECTLY BEHIND the text
   - Return this as "bgColor" (hex without # prefix)
   - If text sits on a white/light area: "FFFFFF" or "F5F5F5"
   - If text sits on a dark area: return that dark colour (e.g. "1A1A2E")
   - If text sits on a gradient, pick the dominant/average colour
   - If text sits on a complex image area, pick the most common colour in that region
   - This background colour will be used to COVER the original text, so accuracy matters

OUTPUT FORMAT — Return ONLY valid JSON (no markdown, no code fences):

{
  "imageWidth": IMAGE_WIDTH,
  "imageHeight": IMAGE_HEIGHT,
  "texts": [
    {
      "id": "title-main",
      "content": "The text content here",
      "x": 120,
      "y": 45,
      "w": 800,
      "h": 55,
      "fontSizePx": 38,
      "fontColor": "2C5F5D",
      "bgColor": "E8F4F0",
      "bold": true,
      "align": "left"
    }
  ]
}

CRITICAL:
- ALL coordinates in PIXELS, not inches
- Be extremely precise with x and y — off by even 20px will look wrong
- Include the imageWidth and imageHeight you were told in the response
- Extract ALL text — titles, headers, labels, body text, captions, watermarks
- IDs should be descriptive: "title-main", "label-crm", "desc-ai-architecture"
- ALWAYS include bgColor for every text element`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image_base64, provider: reqProvider, model: reqModel, api_key: reqApiKey, slide_size, image_width, image_height } = await req.json();

    let provider = reqProvider || 'openai';
    let model = reqModel || (provider === 'openai' ? 'gpt-4o' : provider === 'anthropic' ? 'claude-sonnet-4-20250514' : '');

    function getKeyForProvider(p: string): string {
      if (p === 'openai') return Deno.env.get('OPENAI_API_KEY') || '';
      if (p === 'anthropic') return Deno.env.get('ANTHROPIC_API_KEY') || '';
      return '';
    }

    let api_key = reqApiKey || getKeyForProvider(provider);

    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'Missing required field: image_base64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!api_key) {
      return new Response(JSON.stringify({ error: 'No API key provided and no server default configured.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const slideW = slide_size === '4:3' ? 10 : 10;
    const slideH = slide_size === '4:3' ? 7.5 : 5.625;

    const dimHint = image_width && image_height
      ? `Image dimensions: ${image_width}px wide × ${image_height}px tall.`
      : 'Estimate the image dimensions from the image itself.';

    const userMessage = `Analyze this infographic. ${dimHint} Return pixel-based bounding boxes for every text element.`;

    let result: string | null = null;

    async function callOpenAI(key: string, mdl: string, isOpenRouter = false): Promise<{ ok: boolean; result?: string; error?: string }> {
      const url = isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const body: Record<string, unknown> = {
        model: mdl,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: userMessage },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
          ] },
        ],
        max_tokens: 8000,
        temperature: 0.1,
      };
      if (!isOpenRouter) body.response_format = { type: 'json_object' };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { ok: false, error: `OpenAI API error (${resp.status}): ${err.substring(0, 500)}` };
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content;
      return text ? { ok: true, result: text } : { ok: false, error: 'Empty response from OpenAI' };
    }

    async function callAnthropic(key: string, mdl: string): Promise<{ ok: boolean; result?: string; error?: string }> {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: mdl,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image_base64 } },
            { type: 'text', text: userMessage },
          ] }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return { ok: false, error: `Anthropic API error (${resp.status}): ${err.substring(0, 500)}` };
      }
      const data = await resp.json();
      const text = data.content?.[0]?.text;
      return text ? { ok: true, result: text } : { ok: false, error: 'Empty response from Anthropic' };
    }

    async function callProvider(p: string, key: string, mdl: string): Promise<{ ok: boolean; result?: string; error?: string }> {
      if (p === 'openai') return callOpenAI(key, mdl);
      if (p === 'openrouter') return callOpenAI(key, mdl, true);
      if (p === 'anthropic') return callAnthropic(key, mdl);
      return { ok: false, error: `Unknown provider: ${p}` };
    }

    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callProvider(provider, api_key, model);
      if (res.ok && res.result) { result = res.result; break; }
      lastError = res.error || 'Unknown error';
      console.warn(`Attempt ${attempt + 1} with ${provider} failed: ${lastError}`);
      if (lastError.includes('(401)')) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }

    if (!result) {
      const fallbackProvider = provider === 'openai' ? 'anthropic' : 'openai';
      const fallbackKey = getKeyForProvider(fallbackProvider);
      const fallbackModel = fallbackProvider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514';
      if (fallbackKey) {
        console.log(`Falling back to ${fallbackProvider}...`);
        const res = await callProvider(fallbackProvider, fallbackKey, fallbackModel);
        if (res.ok && res.result) {
          result = res.result;
        } else {
          lastError = res.error || lastError;
        }
      }
    }

    if (!result) {
      return new Response(JSON.stringify({ error: lastError || 'All AI providers failed.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let cleaned = result.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
    }

    let aiResponse;
    try {
      aiResponse = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', cleaned.substring(0, 200));
      return new Response(JSON.stringify({ error: 'AI returned invalid JSON. Try re-analyzing.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Convert pixel-based AI response to inch-based slide coordinates
    const imgW = aiResponse.imageWidth || image_width || 1920;
    const imgH = aiResponse.imageHeight || image_height || 1080;

    const elements = [
      {
        type: 'image_region' as const,
        id: 'background',
        description: 'Full infographic background',
        cropBox: { x: 0, y: 0, width: imgW, height: imgH },
        x: 0, y: 0, w: slideW, h: slideH,
      },
      ...(aiResponse.texts || []).map((t: any) => {
        const rawX = (t.x / imgW) * slideW;
        const rawY = (t.y / imgH) * slideH;
        const rawW = (t.w / imgW) * slideW;
        const rawH = (t.h / imgH) * slideH;
        const padX = rawW * 0.05;
        const padY = rawH * 0.1;
        return {
          type: 'text' as const,
          id: t.id || 'text',
          content: t.content || '',
          x: parseFloat((rawX - padX).toFixed(3)),
          y: parseFloat((rawY - padY).toFixed(3)),
          w: parseFloat((rawW + padX * 2).toFixed(3)),
          h: parseFloat((rawH + padY * 2).toFixed(3)),
          fontSize: Math.round(t.fontSizePx * (slideH / imgH) * 72),
          fontFace: 'Arial',
          fontColor: (t.fontColor || '000000').replace('#', ''),
          bold: !!t.bold,
          italic: false,
          align: t.align || 'left',
          valign: 'middle',
          backgroundColor: (t.bgColor || 'FFFFFF').replace('#', ''),
        };
      }),
    ];

    const layout = {
      slide: { width: slideW, height: slideH, backgroundColor: 'FFFFFF' },
      elements,
    };

    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal error';
    console.error('Edge function error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
