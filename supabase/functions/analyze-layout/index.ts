const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a precision layout analysis engine. Your job is to deconstruct infographic images into individual, editable PowerPoint components.

TASK:
Analyze the provided image and return a JSON structure that precisely maps every visual element — text blocks, icons, diagrams, decorative shapes, and visual regions — to coordinates on a standard PowerPoint slide.

COORDINATE SYSTEM:
- All x, y, w, h values are in INCHES
- Origin (0,0) is the top-left corner
- Be extremely precise with positioning — elements should reconstruct the original layout faithfully

RULES FOR ELEMENT EXTRACTION:

1. TEXT ELEMENTS:
   - Extract EVERY piece of text as a separate text element
   - Group text that belongs together (e.g., a heading + subheading in one box) only if they share the same visual container
   - Estimate font size in points based on visual proportions (title ~28-36pt, body ~12-16pt, captions ~9-11pt)
   - Detect font weight (bold/not bold) and style (italic/not italic)
   - Identify text color as hex WITHOUT # prefix (e.g., "FFFFFF")
   - Identify text alignment (left, center, right)
   - If text sits on a colored background box, include backgroundColor

2. IMAGE REGIONS:
   - Identify distinct visual areas: icons, illustrations, photos, diagrams, charts, logos
   - For each, provide a cropBox in PIXEL coordinates relative to the original image dimensions
   - The cropBox should tightly bound the visual element with ~5px padding
   - Also provide the placement coordinates (x, y, w, h) in inches for where this region sits on the slide
   - Write a brief description of what the region contains

3. SHAPE ELEMENTS:
   - Identify background shapes, dividers, arrows, connectors, and decorative elements
   - Map each to the closest PowerPoint shape: rect, roundRect, ellipse, line, arrow
   - Include fill color and border color where visible

4. LAYERING:
   - Return elements in back-to-front order (background shapes first, then images, then text on top)
   - This ensures proper z-ordering in PowerPoint

5. BACKGROUND:
   - Identify the overall slide background color
   - If the background is a gradient or image, set backgroundColor to the dominant color

OUTPUT FORMAT:
Return ONLY valid JSON matching this exact structure (no markdown, no explanation, no code fences):

{
  "slide": {
    "width": 10,
    "height": 5.625,
    "backgroundColor": "HEXCOLOR"
  },
  "elements": [
    {
      "type": "shape",
      "id": "bg-shape-1",
      "shapeType": "rect",
      "x": 0, "y": 0, "w": 10, "h": 2,
      "fillColor": "1A1A2E",
      "borderColor": null,
      "borderWidth": 0,
      "rotation": 0
    },
    {
      "type": "image_region",
      "id": "icon-1",
      "description": "Brain/AI neural network illustration",
      "cropBox": { "x": 450, "y": 200, "width": 300, "height": 280 },
      "x": 3.5, "y": 1.2, "w": 2.5, "h": 2.3
    },
    {
      "type": "text",
      "id": "title-1",
      "content": "The Modern Agency Operating System",
      "x": 0.5, "y": 0.3, "w": 6, "h": 0.8,
      "fontSize": 28,
      "fontFace": "Arial",
      "fontColor": "1A1A2E",
      "bold": true,
      "italic": false,
      "align": "left",
      "valign": "top",
      "backgroundColor": null,
      "borderColor": null,
      "borderWidth": 0
    }
  ]
}

CRITICAL NOTES:
- Return ONLY the JSON. No markdown fences. No explanatory text.
- Every color value should be hex WITHOUT the # prefix (PowerPoint convention)
- Ensure cropBox coordinates are in PIXELS relative to the original image dimensions
- Be thorough: miss nothing. Every text block, every icon, every decorative element.
- IDs should be descriptive: "title-main", "subtitle-1", "icon-brain", "arrow-flow-1", etc.
- For complex diagrams with embedded text, extract the text as separate text elements overlaying the diagram image region`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image_base64, provider: reqProvider, model: reqModel, api_key: reqApiKey, slide_size, image_width, image_height } = await req.json();

    // Use request values or fall back to server defaults
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
      ? `The original image dimensions are ${image_width}px × ${image_height}px.`
      : '';

    const userMessage = `Analyze this infographic image and return the layout JSON. ${dimHint} ${sizeHint} Deconstruct every element for PowerPoint reconstruction.`;
    const fullSystemPrompt = SYSTEM_PROMPT;

    let result: string | null = null;

    async function callOpenAI(key: string, mdl: string, isOpenRouter = false): Promise<{ ok: boolean; result?: string; error?: string }> {
      const url = isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const body: Record<string, unknown> = {
        model: mdl,
        messages: [
          { role: 'system', content: fullSystemPrompt },
          { role: 'user', content: [
            { type: 'text', text: userMessage },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${image_base64}` } },
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
          system: fullSystemPrompt,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image_base64 } },
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

    // Try primary provider with 1 retry
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callProvider(provider, api_key, model);
      if (res.ok && res.result) { result = res.result; break; }
      lastError = res.error || 'Unknown error';
      console.warn(`Attempt ${attempt + 1} with ${provider} failed: ${lastError}`);
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }

    // Fallback: if primary failed and we have a different provider key available, try it
    if (!result && !reqApiKey) {
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

    // Parse JSON from response — handle markdown code fences if AI wraps them
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

    // Basic validation
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
