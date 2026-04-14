import { AIResponse, AITextBlock } from '@/types/layout';
import { groupOCRLines, OCRLine, runOCR } from './ocr';

type Box = { x: number; y: number; width: number; height: number };

interface TextMatch {
  blockIndex: number;
  candidateIndex: number;
  score: number;
  aiBox: Box;
  ocrBox: Box;
}

export interface CoordinateTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

const MIN_MATCH_SCORE = 0.58;
const MIN_MATCH_COUNT = 3;

export async function refineAIResponseWithOCR(
  imageDataUrl: string,
  aiResponse: AIResponse,
  originalSize: { width: number; height: number },
): Promise<AIResponse> {
  const scaledResponse = scaleAIResponseToImage(aiResponse, originalSize.width, originalSize.height);

  try {
    const rawLines = await runOCR(imageDataUrl);
    const candidates = dedupeOCRLines([...rawLines, ...groupOCRLines(rawLines)]);
    const matches = matchTextBlocksToOCR(scaledResponse.textBlocks || [], candidates);

    if (matches.length < MIN_MATCH_COUNT) {
      return scaledResponse;
    }

    const transform = deriveCoordinateTransform(matches);
    const refinedResponse = applyTransformToAIResponse(
      scaledResponse,
      transform,
      originalSize.width,
      originalSize.height,
    );

    for (const match of matches) {
      const textBlock = refinedResponse.textBlocks[match.blockIndex];
      if (!textBlock) continue;

      textBlock.boundingBox = clampBox(match.ocrBox, originalSize.width, originalSize.height);
    }

    return refinedResponse;
  } catch (error) {
    console.warn('OCR refinement failed, falling back to scaled AI boxes.', error);
    return scaledResponse;
  }
}

export function scaleAIResponseToImage(
  aiResponse: AIResponse,
  targetWidth: number,
  targetHeight: number,
): AIResponse {
  const clone = cloneAIResponse(aiResponse);
  const sourceWidth = aiResponse.imageWidth || targetWidth;
  const sourceHeight = aiResponse.imageHeight || targetHeight;
  const scaleX = sourceWidth ? targetWidth / sourceWidth : 1;
  const scaleY = sourceHeight ? targetHeight / sourceHeight : 1;

  for (const textBlock of clone.textBlocks) {
    if (!textBlock.boundingBox) continue;
    textBlock.boundingBox = scaleBox(textBlock.boundingBox, scaleX, scaleY);
  }

  for (const imageRegion of clone.imageRegions) {
    imageRegion.cropBox = scaleBox(imageRegion.cropBox, scaleX, scaleY);
  }

  clone.imageWidth = targetWidth;
  clone.imageHeight = targetHeight;

  return clone;
}

export function matchTextBlocksToOCR(textBlocks: AITextBlock[], ocrLines: OCRLine[]): TextMatch[] {
  const candidatePairs: TextMatch[] = [];

  textBlocks.forEach((textBlock, blockIndex) => {
    if (!textBlock.boundingBox) return;

    ocrLines.forEach((ocrLine, candidateIndex) => {
      const score = textSimilarity(textBlock.content, ocrLine.text);
      if (score < MIN_MATCH_SCORE) return;

      candidatePairs.push({
        blockIndex,
        candidateIndex,
        score,
        aiBox: textBlock.boundingBox,
        ocrBox: ocrLine.bbox,
      });
    });
  });

  candidatePairs.sort((a, b) => b.score - a.score);

  const usedBlocks = new Set<number>();
  const usedCandidates = new Set<number>();
  const matches: TextMatch[] = [];

  for (const pair of candidatePairs) {
    if (usedBlocks.has(pair.blockIndex) || usedCandidates.has(pair.candidateIndex)) {
      continue;
    }

    usedBlocks.add(pair.blockIndex);
    usedCandidates.add(pair.candidateIndex);
    matches.push(pair);
  }

  return matches;
}

export function deriveCoordinateTransform(matches: TextMatch[]): CoordinateTransform {
  if (matches.length === 0) {
    return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  }

  const aiBounds = mergeBoxes(matches.map((match) => match.aiBox));
  const ocrBounds = mergeBoxes(matches.map((match) => match.ocrBox));

  const widthRatios = matches
    .map((match) => match.ocrBox.width / Math.max(match.aiBox.width, 1))
    .filter((value) => Number.isFinite(value) && value > 0);
  const heightRatios = matches
    .map((match) => match.ocrBox.height / Math.max(match.aiBox.height, 1))
    .filter((value) => Number.isFinite(value) && value > 0);

  const spanScaleX = aiBounds.width > 0 ? ocrBounds.width / aiBounds.width : 1;
  const spanScaleY = aiBounds.height > 0 ? ocrBounds.height / aiBounds.height : 1;
  const medianScaleX = median(widthRatios) || 1;
  const medianScaleY = median(heightRatios) || 1;

  const scaleX = clamp((spanScaleX + medianScaleX) / 2, 0.25, 4);
  const scaleY = clamp((spanScaleY + medianScaleY) / 2, 0.25, 4);
  const offsetX = median(matches.map((match) => match.ocrBox.x - match.aiBox.x * scaleX));
  const offsetY = median(matches.map((match) => match.ocrBox.y - match.aiBox.y * scaleY));

  return { scaleX, scaleY, offsetX, offsetY };
}

export function applyTransformToAIResponse(
  aiResponse: AIResponse,
  transform: CoordinateTransform,
  imageWidth: number,
  imageHeight: number,
): AIResponse {
  const clone = cloneAIResponse(aiResponse);

  for (const textBlock of clone.textBlocks) {
    if (!textBlock.boundingBox) continue;
    textBlock.boundingBox = clampBox(
      transformBox(textBlock.boundingBox, transform),
      imageWidth,
      imageHeight,
    );
  }

  for (const imageRegion of clone.imageRegions) {
    imageRegion.cropBox = clampBox(
      transformBox(imageRegion.cropBox, transform),
      imageWidth,
      imageHeight,
    );
  }

  clone.imageWidth = imageWidth;
  clone.imageHeight = imageHeight;

  return clone;
}

function cloneAIResponse(aiResponse: AIResponse): AIResponse {
  return {
    imageWidth: aiResponse.imageWidth,
    imageHeight: aiResponse.imageHeight,
    layout: {
      ...aiResponse.layout,
      sections: (aiResponse.layout.sections || []).map((section) => ({ ...section })),
    },
    imageRegions: (aiResponse.imageRegions || []).map((imageRegion) => ({
      ...imageRegion,
      cropBox: { ...imageRegion.cropBox },
    })),
    textBlocks: (aiResponse.textBlocks || []).map((textBlock) => ({
      ...textBlock,
      boundingBox: textBlock.boundingBox ? { ...textBlock.boundingBox } : undefined,
    })),
  };
}

function scaleBox(box: Box, scaleX: number, scaleY: number): Box {
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

function transformBox(box: Box, transform: CoordinateTransform): Box {
  return {
    x: box.x * transform.scaleX + transform.offsetX,
    y: box.y * transform.scaleY + transform.offsetY,
    width: box.width * transform.scaleX,
    height: box.height * transform.scaleY,
  };
}

function clampBox(box: Box, maxWidth: number, maxHeight: number): Box {
  const x = clamp(box.x, 0, Math.max(0, maxWidth - 1));
  const y = clamp(box.y, 0, Math.max(0, maxHeight - 1));
  const width = clamp(box.width, 1, Math.max(1, maxWidth - x));
  const height = clamp(box.height, 1, Math.max(1, maxHeight - y));

  return { x, y, width, height };
}

function mergeBoxes(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function dedupeOCRLines(lines: OCRLine[]): OCRLine[] {
  const seen = new Set<string>();
  const deduped: OCRLine[] = [];

  for (const line of lines) {
    const key = [
      normalizeText(line.text),
      Math.round(line.bbox.x),
      Math.round(line.bbox.y),
      Math.round(line.bbox.width),
      Math.round(line.bbox.height),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  return deduped;
}

function textSimilarity(a: string, b: string): number {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);

  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const compactA = normalizedA.replace(/\s+/g, '');
  const compactB = normalizedB.replace(/\s+/g, '');
  const containmentScore =
    compactA.includes(compactB) || compactB.includes(compactA)
      ? Math.min(compactA.length, compactB.length) / Math.max(compactA.length, compactB.length)
      : 0;
  const diceScore = diceCoefficient(compactA, compactB);
  const tokenScore = tokenOverlap(normalizedA, normalizedB);

  return Math.max(containmentScore, diceScore * 0.75 + tokenScore * 0.25);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const bigram = a.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) || 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const bigram = b.slice(index, index + 2);
    const count = counts.get(bigram) || 0;
    if (count === 0) continue;
    counts.set(bigram, count - 1);
    overlap += 1;
  }

  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  const union = new Set([...aTokens, ...bTokens]);

  if (union.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  return intersection / union.size;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}