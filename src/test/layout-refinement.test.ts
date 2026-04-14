import { describe, expect, it } from 'vitest';
import {
  applyTransformToAIResponse,
  deriveCoordinateTransform,
  matchTextBlocksToOCR,
  scaleAIResponseToImage,
} from '@/lib/layout-refinement';
import { AIResponse } from '@/types/layout';

describe('layout refinement', () => {
  it('scales AI boxes to the original image size', () => {
    const aiResponse: AIResponse = {
      imageWidth: 100,
      imageHeight: 100,
      layout: { columns: 1, flow: 'free', sections: [] },
      imageRegions: [
        {
          id: 'icon',
          description: 'Icon',
          cropBox: { x: 10, y: 20, width: 10, height: 10 },
          positionHint: 'left',
          section: 'main',
        },
      ],
      textBlocks: [
        {
          id: 'title',
          content: 'Retail media needs more intelligence',
          type: 'title',
          positionHint: 'top-left',
          section: 'main',
          fontColor: '000000',
          bold: true,
          size: 'large',
          boundingBox: { x: 20, y: 10, width: 40, height: 10 },
        },
      ],
    };

    const scaled = scaleAIResponseToImage(aiResponse, 200, 300);

    expect(scaled.imageWidth).toBe(200);
    expect(scaled.imageHeight).toBe(300);
    expect(scaled.textBlocks[0].boundingBox).toEqual({ x: 40, y: 30, width: 80, height: 30 });
    expect(scaled.imageRegions[0].cropBox).toEqual({ x: 20, y: 60, width: 20, height: 30 });
  });

  it('derives a transform from OCR matches and applies it to image regions', () => {
    const aiResponse: AIResponse = {
      imageWidth: 1200,
      imageHeight: 700,
      layout: { columns: 1, flow: 'free', sections: [] },
      imageRegions: [
        {
          id: 'icon',
          description: 'Icon',
          cropBox: { x: 40, y: 100, width: 40, height: 40 },
          positionHint: 'left',
          section: 'main',
        },
      ],
      textBlocks: [
        {
          id: 'title',
          content: 'Retail media needs more intelligence',
          type: 'title',
          positionHint: 'top-left',
          section: 'main',
          fontColor: '000000',
          bold: true,
          size: 'large',
          boundingBox: { x: 100, y: 30, width: 600, height: 50 },
        },
        {
          id: 'heading',
          content: 'Resulting in',
          type: 'heading',
          positionHint: 'top-left',
          section: 'main',
          fontColor: '000000',
          bold: true,
          size: 'medium',
          boundingBox: { x: 100, y: 490, width: 200, height: 40 },
        },
        {
          id: 'label',
          content: 'Small finite audiences',
          type: 'label',
          positionHint: 'top-left',
          section: 'main',
          fontColor: '000000',
          bold: false,
          size: 'small',
          boundingBox: { x: 100, y: 540, width: 300, height: 30 },
        },
      ],
    };

    const matches = matchTextBlocksToOCR(aiResponse.textBlocks, [
      {
        text: 'Retail media needs more intelligence',
        bbox: { x: 100, y: 315, width: 600, height: 25 },
        confidence: 98,
      },
      {
        text: 'Resulting in',
        bbox: { x: 100, y: 545, width: 200, height: 20 },
        confidence: 95,
      },
      {
        text: 'Small finite audiences',
        bbox: { x: 100, y: 570, width: 300, height: 15 },
        confidence: 94,
      },
    ]);

    const transform = deriveCoordinateTransform(matches);
    const refined = applyTransformToAIResponse(aiResponse, transform, 1200, 700);

    expect(matches).toHaveLength(3);
    expect(transform.scaleX).toBeCloseTo(1, 2);
    expect(transform.scaleY).toBeCloseTo(0.5, 2);
    expect(transform.offsetY).toBeCloseTo(300, 2);
    expect(refined.imageRegions[0].cropBox.x).toBeCloseTo(40, 2);
    expect(refined.imageRegions[0].cropBox.y).toBeCloseTo(350, 2);
    expect(refined.imageRegions[0].cropBox.width).toBeCloseTo(40, 2);
    expect(refined.imageRegions[0].cropBox.height).toBeCloseTo(20, 2);
  });

  it('prefers a single-line OCR candidate over a merged multi-line block', () => {
    const matches = matchTextBlocksToOCR(
      [
        {
          id: 'text-cpgs-want-more',
          content: 'CPGs want more: better insights, better targeting, and better measurement.',
          type: 'body',
          positionHint: 'left',
          section: 'main',
          fontColor: '444444',
          bold: false,
          size: 'medium',
          boundingBox: { x: 70, y: 180, width: 600, height: 40 },
        },
      ],
      [
        {
          text: 'CPGs want more: better insights, better targeting, and better measurement.',
          bbox: { x: 72, y: 181, width: 596, height: 39 },
          confidence: 96,
        },
        {
          text: 'CPGs want more: better insights, better targeting, and better measurement.\nPrivacy changes mean traditional ID-based targeting is disappearing.',
          bbox: { x: 72, y: 181, width: 598, height: 84 },
          confidence: 96,
        },
      ],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ocrBox.height).toBe(39);
  });
});
