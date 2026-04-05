import { supabase } from '@/integrations/supabase/client';
import { LayoutAnalysis } from '@/types/layout';
import { AppSettings } from '@/types/layout';

export async function analyzeLayout(
  imageBase64: string,
  settings: AppSettings
): Promise<LayoutAnalysis> {
  const { data, error } = await supabase.functions.invoke('analyze-layout', {
    body: {
      image_base64: imageBase64,
      provider: settings.provider,
      model: settings.model,
      api_key: settings.apiKey,
      slide_size: settings.slideSize,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to analyze layout');
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as LayoutAnalysis;
}
