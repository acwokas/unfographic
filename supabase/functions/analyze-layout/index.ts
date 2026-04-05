import { corsHeaders } from '@supabase/supabase-js/cors'

const SYSTEM_PROMPT = `You are a layout analysis AI. You analyze images of slides, infographics, and visual content, then return a precise JSON structure describing every element's position, size, and styling.

RULES:
1. Return ONLY valid JSON — no markdown, no explanation, no code fences.
2. Use inches for all positions and sizes. Standard 16:9 slide is 10" x 5.625". Standard 4:3 slide is 10" x 7.5".
3. Identify every distinct element: text blocks, images/photos/illustrations, shapes, decorative elements.
4. For text: extract the exact text content, estimate font size in points, identify colors as hex, detect bold/italic/alignment.
5. For image regions: provide pixel coordinates (cropBox) relative to the original image for where this visual region exists.
6. For shapes: identify rectangles, rounded rectangles, ellipses, lines, arrows.
7. Be precise with coordinates — elements should not overlap unless they do in the original.
8. Use the element id format: "el_001", "el_002", etc.
9. Background color should be the dominant background color of the slide.

Return this exact JSON structure:
{
  "slide": {
    "width": <number>,
    "height": <number>,
    "backgroundColor": "<hex>"
  },
  "elements": [
    {
      "type": "text",
      "id": "<string>",
      "content": "<string>",
      "x": <number>, "y": <number>, "w": <number>, "h": <number>,
      "fontSize": <number>,
      "fontFace": "<string>",
      "fontColor": "<hex>",
      "bold": <boolean>,
      "italic": <boolean>,
      "align": "left"|"center"|"right",
      "valign": "top"|"middle"|"bottom",
      "backgroundColor": "<hex or null>",
      "borderColor": "<hex or null>",
      "borderWidth": <number or null>
    },
    {
      "type": "image_region",
      "id": "<string>",
      "description": "<string>",
      "cropBox": { "x": <px>, "y": <px>, "width": <px>, "height": <px> },
      "x": <number>, "y": <number>, "w": <number>, "h": <number>
    },
    {
      "type": "shape",
      "id": "<string>",
      "shapeType": "rect"|"roundRect"|"ellipse"|"line"|"arrow",
      "x": <number>, "y": <number>, "w": <number>, "h": <number>,
      "fillColor": "<hex or null>",
      "borderColor": "<hex or null>",
      "borderWidth": <number or null>,
      "rotation": <number or null>
    }
  ]
}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image_base64, provider, model, api_key, slide_size } = await req.json();

    if (!image_base64 || !provider || !model || !api_key) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sizeHint = slide_size === '4:3' ? 'This is a 4:3 slide (10" x 7.5").' : 'This is a 16:9 slide (10" x 5.625").';
    const fullPrompt = SYSTEM_PROMPT + '\n\n' + sizeHint;

    let result: string;

    if (provider === 'openai' || provider === 'openrouter') {
      const url = provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api_key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: fullPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this image and return the layout JSON.' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${image_base64}` } },
              ],
            },
          ],
          max_tokens: 4096,
          temperature: 0.1,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return new Response(JSON.stringify({ error: `${provider} API error: ${err}` }), {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await resp.json();
      result = data.choices[0].message.content;
    } else if (provider === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: fullPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: image_base64 },
                },
                { type: 'text', text: 'Analyze this image and return the layout JSON.' },
              ],
            },
          ],
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return new Response(JSON.stringify({ error: `Anthropic API error: ${err}` }), {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await resp.json();
      result = data.content[0].text;
    } else {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse JSON from response (handle markdown code fences)
    let cleaned = result.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const layout = JSON.parse(cleaned);

    return new Response(JSON.stringify(layout), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
