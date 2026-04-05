export interface TextElement {
  type: 'text';
  id: string;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFace: string;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface ImageRegionElement {
  type: 'image_region';
  id: string;
  description: string;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  x: number;
  y: number;
  w: number;
  h: number;
  croppedDataUrl?: string;
}

export interface ShapeElement {
  type: 'shape';
  id: string;
  shapeType: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow';
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  rotation?: number;
}

export type LayoutElement = TextElement | ImageRegionElement | ShapeElement;

export interface LayoutAnalysis {
  slide: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  elements: LayoutElement[];
}

// Raw AI response (before layout engine)
export interface AILayoutSection {
  name: string;
  position: string;
  description: string;
}

export interface AIImageRegion {
  id: string;
  description: string;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  positionHint: string;
  section: string;
}

export interface AITextBlock {
  id: string;
  content: string;
  type: 'title' | 'subtitle' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';
  positionHint: string;
  section: string;
  fontColor: string;
  bold: boolean;
  size: 'large' | 'medium' | 'small' | 'tiny';
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AIResponse {
  imageWidth: number;
  imageHeight: number;
  layout: {
    columns: number;
    flow: string;
    sections: AILayoutSection[];
  };
  imageRegions: AIImageRegion[];
  textBlocks: AITextBlock[];
}

export interface AppSettings {
  provider: 'openai' | 'anthropic' | 'openrouter';
  apiKey: string;
  useCustomApiKey?: boolean;
  model: string;
  slideSize: '16:9' | '4:3';
}

export interface ConversionJob {
  id: string;
  fileName: string;
  imageDataUrl: string;
  originalImage?: HTMLImageElement;
  layout?: LayoutAnalysis;
  status: 'uploading' | 'analyzing' | 'ready' | 'error';
  error?: string;
}
