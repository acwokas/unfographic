const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a precision layout analysis engine. Your job is to deconstruct infographic images into editable PowerPoint components.

STRATEGY — USE A LAYERED APPROACH:

1. FIRST: Place the ENTIRE original image as a single full-slide background image region
2. THEN: Extract ONLY the text elements as overlays on top, so users can edit the copy

This means every infographic gets deconstructed as:
- One full-bleed background image (the original infographic)
- Multiple editable text boxes positioned precisely over where text appears in the image

Users can then: edit any text, delete text boxes they don't need, or delete the background and keep only the text.

COORDINATE SYSTEM:
- All x, y, w, h values in INCHES
- Origin (0,0) is top-left
- Be precise — text boxes must sit exactly over the text in the background image

RULES:

1. BACKGROUND IMAGE:
   - Always include exactly ONE image_region element with id "background"
   - Its cropBox covers the entire image: { x: 0, y: 0, width: IMAGE_WIDTH, height: IMAGE_HEIGHT }
   - Placement fills the full slide

2. TEXT ELEMENTS:
   - Extract every readable text string as a separate text element
   - Position each text box EXACTLY over where that text appears in the background
   - Size the text box to tightly fit the text (not too wide, not too tall)
   - Estimate font size carefully based on visual proportions
   - Group a heading with its immediate subtext ONLY if they're visually a single block
   - For bullet lists, keep each bullet as a separate text element

3. DO NOT:
   - Do NOT create multiple image_region elements for individual icons, diagrams, or illustrations
   - Do NOT create shape elements (the background image already contains them)
   - Do NOT duplicate — if text is in the background image, the text overlay is the editable version

4. ELEMENT ORDER:
   - First element: the background image_region
   - Remaining elements: text overlays, ordered top-to-bottom, left-to-right

5. TEXT STYLING:
   - Match font color to what's visible in the image
   - Set backgroundColor to null (text floats over the background image)
   - Bold for headings and emphasis
   - Use fontFace "Arial" as default

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no code fences, no explanation):

{
  "slide": {
    "width": 10,
    "height": 5.625,
    "backgroundColor": "FFFFFF"
  },
  "elements": [
    {
      "type": "image_region",
      "id": "background",
      "description": "Full infographic background",
      "cropBox": { "x": 0, "y": 0, "width": ORIGINAL_WIDTH, "height": ORIGINAL_HEIGHT },
      "x": 0, "y": 0, "w": 10, "h": 5.625
    },
    {
      "type": "text",
      "id": "title-main",
      "content": "The Modern Agency Operating System",
      "x": 0.3, "y": 0.2, "w": 5.5, "h": 0.7,
      "fontSize": 22,
      "fontFace": "Arial",
      "fontColor": "1A1A2E",
      "bold": true,
      "italic": false,
      "align": "left",
      "valign": "top",
      "backgroundColor": null
    }
  ]
}

CRITICAL:
- Every color hex WITHOUT the # prefix
- Only ONE image_region (the full background)
- All other elements are type "text" only
- Be thorough: extract ALL visible text, even small captions and labels
- IDs should be descriptive: "title-main", "section-header-1", "label-crm", "caption-bottom-left"`;

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
    const sizeHint = `Slide dimensions: ${slideW}" x ${slideH}" (${slide_size || '16:9'} aspect ratio).`;
    const dimHint = image_width && image_height
      ? `The original image dimensions are ${image_width}px × ${image_height}px. Use these exact values for the background cropBox.`
      : '';

    const userMessage = `Analyze this infographic image and return the layout JSON. ${dimHint} ${sizeHint} Extract the full image as background and all text as overlays.`;

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

    let layout;
    try {
      layout = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', cleaned.substring(0, 200));
      return new Response(JSON.stringify({ error: 'AI returned invalid JSON. Try re-analyzing.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!layout.slide || !Array.isArray(layout.elements)) {
      return new Response(JSON.stringify({ error: 'AI response missing slide or elements fields. Try re-analyzing.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
