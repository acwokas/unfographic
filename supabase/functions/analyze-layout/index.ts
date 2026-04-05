const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a precision layout analysis engine. You deconstruct infographic images into editable PowerPoint components.

APPROACH:
1. The ENTIRE original image becomes a full-slide background
2. You extract EVERY SINGLE visible text string as a positioned text overlay with an opaque background
3. In PowerPoint, each text box covers the original text beneath it so users see only the editable version

YOUR TASK:
Given an image of dimensions IMAGE_WIDTH × IMAGE_HEIGHT pixels, identify EVERY text element and return its pixel-based bounding box plus the background colour behind it.

COMPLETENESS IS CRITICAL:
- You MUST extract ALL text — titles, subtitles, headers, body paragraphs, labels, captions, descriptions, watermarks, and attributions
- If you see text in the image, it MUST appear in your output
- Do NOT skip small text, description text, or secondary copy
- Do NOT truncate text content — include the FULL text of every element
- Count your extracted texts and compare against what you see — if you see 25 text areas, return 25 elements

TEXT SEPARATION RULES:
- Headers and their descriptions MUST be SEPARATE elements (never combine "Header\\nDescription" into one)
- Example: "AI-Driven Data Architecture" is one element, "Applying machine learning and audience modelling within a privacy-compliant framework." is a SEPARATE element
- Labels like "CRM", "DSPs", "Social Media" are each individual elements
- Each bullet point or list item is a separate element

BOUNDING BOXES:
- Return x, y, w, h in PIXELS relative to the original image dimensions
- x = pixels from left edge to LEFT side of text
- y = pixels from top edge to TOP of text
- w = pixel width of the text block
- h = pixel height of the text block
- ADD PADDING: make each bounding box ~10% larger than the visible text on all sides
  - This ensures the opaque background fully covers the original text even if positioning is slightly off
  - So if text is 200px wide, return w=220 and shift x left by 10px

BACKGROUND COLOUR (bgColor):
- For EVERY text element, detect the dominant colour of the area DIRECTLY BEHIND the text in the image
- This is REQUIRED — every element must have a bgColor
- If text is on a white/light area: return "FFFFFF" or the actual light colour
- If text is on a dark area: return that dark colour
- If text is on a gradient: pick the average/dominant colour
- If text is on a coloured banner or shape: return that shape's colour
- The bgColor will be used as an opaque fill to COVER the original text, so accuracy matters

FONT SIZE:
- Estimate the cap-height of the text in pixels as fontSizePx
- Large titles: 30-50px
- Section headers: 18-28px
- Body/descriptions: 12-18px
- Small labels/captions: 9-14px

VISUAL PROPERTIES:
- fontColor: hex color WITHOUT # prefix (e.g. "FFFFFF")
- bold: true for headings and emphasized text
- align: "left", "center", or "right"

ELEMENT ORDER:
- Top to bottom, left to right
- Titles first, then section headers, then body text, then captions

OUTPUT FORMAT — Return ONLY valid JSON (no markdown, no code fences):

{
  "imageWidth": IMAGE_WIDTH,
  "imageHeight": IMAGE_HEIGHT,
  "texts": [
    {
      "id": "title-main",
      "content": "The Modern Agency Operating System:",
      "x": 110,
      "y": 35,
      "w": 850,
      "h": 65,
      "fontSizePx": 40,
      "fontColor": "1A2744",
      "bgColor": "E8F0ED",
      "bold": true,
      "align": "left"
    },
    {
      "id": "subtitle-main",
      "content": "From Raw Data to Strategic Growth",
      "x": 110,
      "y": 105,
      "w": 700,
      "h": 50,
      "fontSizePx": 28,
      "fontColor": "444444",
      "bgColor": "E8F0ED",
      "bold": false,
      "align": "left"
    }
  ]
}

CHECKLIST BEFORE RESPONDING:
- Did I extract the main title? ✓
- Did I extract the subtitle? ✓
- Did I extract EVERY section header? ✓
- Did I extract EVERY body description as a SEPARATE element from its header? ✓
- Did I extract ALL labels (CRM, DSPs, Social Media, etc.)? ✓
- Did I extract small text, captions, and watermarks? ✓
- Does EVERY element have a bgColor? ✓
- Did I add padding to bounding boxes? ✓
- Is the content COMPLETE (not truncated)? ✓`;

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
        max_tokens: 16000,
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
          max_tokens: 16000,
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
