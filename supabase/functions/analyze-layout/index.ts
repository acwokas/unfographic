const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a layout deconstruction engine. You break infographic images into separate components for PowerPoint reconstruction.

TASK:
Analyze this infographic and extract two types of elements:
1. IMAGE REGIONS — visual areas (icons, illustrations, diagrams, photos, logos, decorative elements)
2. TEXT BLOCKS — every piece of readable text

IMPORTANT: Extract ALL text. Do not skip anything. Every label, every caption, every heading, every description paragraph must be a separate text entry.

IMAGE REGIONS:
- Identify each distinct visual element (icon, illustration, chart, diagram, logo, decorative graphic)
- For each, provide a crop bounding box in PIXELS relative to the original image
- Add 10px padding around each crop box
- Give each a descriptive name
- Position hint: describe where it sits in the original (e.g. "top-left", "center", "bottom-right")

TEXT BLOCKS:
- Extract EVERY readable text string as a separate element
- Headers and their descriptions must be SEPARATE entries
- Labels like "CRM", "DSPs" are each separate entries
- Include the FULL untruncated text
- Classify each as: "title", "subtitle", "heading", "subheading", "body", "label", or "caption"
- Position hint: describe where it sits (e.g. "top-left", "center-left", "bottom-center")
- Estimate visual properties: bold, font colour (hex no #), approximate relative size (large/medium/small/tiny)

LAYOUT ZONES:
Also describe the overall layout structure of the infographic:
- How many main sections/columns are there?
- What is the flow direction? (left-to-right, top-to-bottom, radial, etc.)
- What are the major groupings of content?

OUTPUT FORMAT — Return ONLY valid JSON (no markdown, no code fences):

{
  "imageWidth": 1920,
  "imageHeight": 1080,
  "layout": {
    "columns": 3,
    "flow": "left-to-right",
    "sections": [
      {"name": "Input/Sources", "position": "left", "description": "Data sources feeding into the system"},
      {"name": "Processing", "position": "center", "description": "Core processing engine"},
      {"name": "Output/Activation", "position": "right", "description": "Output channels"}
    ]
  },
  "imageRegions": [
    {
      "id": "icon-crm",
      "description": "CRM system icon",
      "cropBox": {"x": 50, "y": 280, "width": 120, "height": 100},
      "positionHint": "left",
      "section": "Input/Sources"
    }
  ],
  "textBlocks": [
    {
      "id": "title-main",
      "content": "The Modern Agency Operating System:",
      "type": "title",
      "positionHint": "top-left",
      "section": "global",
      "fontColor": "1A2744",
      "bold": true,
      "size": "large"
    },
    {
      "id": "desc-section1",
      "content": "Applying machine learning within a privacy-compliant framework.",
      "type": "body",
      "positionHint": "center",
      "section": "Processing",
      "fontColor": "444444",
      "bold": false,
      "size": "small"
    }
  ]
}

CHECKLIST:
- Every visible icon, illustration, and diagram is in imageRegions? ✓
- Every heading is in textBlocks? ✓
- Every body/description paragraph is a SEPARATE entry from its heading? ✓
- Every small label (CRM, DSPs, etc.) is included? ✓
- Text content is COMPLETE and not truncated? ✓
- cropBox coordinates are in pixels with 10px padding? ✓`;

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
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!api_key) {
      return new Response(JSON.stringify({ error: 'No API key provided and no server default configured.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dimHint = image_width && image_height
      ? `Image dimensions: ${image_width}px wide × ${image_height}px tall.`
      : 'Estimate the image dimensions from the image itself.';

    const userMessage = `Analyze this infographic. ${dimHint} Extract all image regions and text blocks. Return the structured JSON.`;

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
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pass through the raw AI response — layout engine runs client-side
    return new Response(JSON.stringify(aiResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal error';
    console.error('Edge function error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
