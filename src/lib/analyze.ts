import { supabase } from '@/integrations/supabase/client';
import { AIResponse, AppSettings } from '@/types/layout';

export async function analyzeLayout(
  imageBase64: string,
  settings: AppSettings,
  imageWidth?: number,
  imageHeight?: number
): Promise<AIResponse> {
  const useCustomApiKey = Boolean(settings.useCustomApiKey && settings.apiKey);

  const { data, error } = await supabase.functions.invoke('analyze-layout', {
    body: {
      image_base64: imageBase64,
      provider: settings.provider,
      model: useCustomApiKey ? settings.model : undefined,
      api_key: useCustomApiKey ? settings.apiKey : undefined,
      slide_size: settings.slideSize,
      image_width: imageWidth,
      image_height: imageHeight,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to analyze layout');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as AIResponse;
}
