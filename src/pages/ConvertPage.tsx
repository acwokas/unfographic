import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw, X, Image, Type, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getJob, updateJob } from '@/lib/jobs';
import { loadSettings } from '@/lib/settings';
import { analyzeLayout } from '@/lib/analyze';
import { resizeImageForApi, loadImage, cropImageRegion } from '@/lib/image-utils';
import { generateToolkitPptx } from '@/lib/pptx-generator';
import { AIResponse, ConversionJob } from '@/types/layout';
import Logo from '@/components/Logo';

export default function ConvertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [job, setJob] = useState<ConversionJob | undefined>(id ? getJob(id) : undefined);
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [croppedImages, setCroppedImages] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'original' | 'text' | 'images'>('text');

  useEffect(() => {
    if (!job) { navigate('/'); return; }
    if (job.status === 'uploading') { runAnalysis(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!job || !id) return;
    const settings = loadSettings();

    updateJob(id, { status: 'analyzing' });
    setJob((prev) => prev ? { ...prev, status: 'analyzing' } : prev);

    try {
      const resized = await resizeImageForApi(job.imageDataUrl);
      const base64 = resized.split(',')[1];
      const img = await loadImage(job.imageDataUrl);

      const response = await analyzeLayout(base64, settings, img.naturalWidth, img.naturalHeight);
      setAiResponse(response);

      // Pre-crop image regions
      const crops: Record<string, string> = {};
      for (const region of response.imageRegions) {
        try {
          crops[region.id] = cropImageRegion(img, region.cropBox);
        } catch (e) {
          console.warn('Failed to crop:', region.id, e);
        }
      }
      setCroppedImages(crops);

      updateJob(id, { status: 'ready', originalImage: img });
      setJob((prev) => prev ? { ...prev, status: 'ready', originalImage: img } : prev);
    } catch (e: any) {
      updateJob(id, { status: 'error', error: e.message });
      setJob((prev) => prev ? { ...prev, status: 'error', error: e.message } : prev);
      toast({ title: 'Analysis failed', description: e.message, variant: 'destructive' });
    }
  }, [job, id, toast]);

  const handleDeleteText = (textId: string) => {
    if (!aiResponse) return;
    setAiResponse({
      ...aiResponse,
      textBlocks: aiResponse.textBlocks.filter((t) => t.id !== textId),
    });
  };

  const handleDeleteImage = (imgId: string) => {
    if (!aiResponse) return;
    setAiResponse({
      ...aiResponse,
      imageRegions: aiResponse.imageRegions.filter((r) => r.id !== imgId),
    });
  };

  const handleDownload = async () => {
    if (!aiResponse || !job?.originalImage) return;
    try {
      await generateToolkitPptx(aiResponse, job.originalImage, job.imageDataUrl);
      toast({ title: 'All done. Your toolkit deck is ready. 🎉' });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!job) return null;

  const textCount = aiResponse?.textBlocks.length || 0;
  const imageCount = aiResponse?.imageRegions.length || 0;
  const sections = aiResponse?.layout?.sections || [];

  const textsForSection = (sectionName: string) =>
    aiResponse?.textBlocks.filter(
      (t) => t.section === sectionName && t.type !== 'title' && t.type !== 'subtitle'
    ) || [];

  const globalTexts = aiResponse?.textBlocks.filter(
    (t) => (t.section === 'global' || !t.section) && !['title', 'subtitle'].includes(t.type)
  ) || [];

  const titles = aiResponse?.textBlocks.filter(
    (t) => t.type === 'title' || t.type === 'subtitle'
  ) || [];

  const tabs = [
    { key: 'original' as const, label: 'Original', icon: Eye },
    { key: 'text' as const, label: `Text (${textCount})`, icon: Type },
    { key: 'images' as const, label: `Images (${imageCount})`, icon: Image },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Logo className="text-lg" />
        <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Upload
        </Button>
      </nav>

      <main className="flex-1 flex flex-col items-center px-4 py-6 max-w-4xl mx-auto w-full">
        {/* Status */}
        {job.status === 'analyzing' && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-muted-foreground font-light">Deconstructing… extracting text and visual components.</p>
          </div>
        )}

        {job.status === 'error' && (
          <div className="text-center space-y-4 max-w-sm py-20">
            <p className="text-destructive font-medium">{job.error}</p>
            <p className="text-muted-foreground text-sm font-light">Try a different image, or check your API key in Settings.</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" className="rounded-xl" onClick={runAnalysis}>
                <RefreshCw className="h-4 w-4 mr-1" /> Try Again
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => navigate('/settings')}>
                Settings
              </Button>
            </div>
          </div>
        )}

        {job.status === 'ready' && aiResponse && (
          <>
            {/* Summary */}
            <p className="text-muted-foreground text-sm font-light mb-4">
              {textCount} text blocks and {imageCount} visuals extracted.
            </p>

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/30 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="w-full">
              {activeTab === 'original' && (
                <div className="rounded-xl overflow-hidden border border-border bg-card">
                  <img src={job.imageDataUrl} alt="Original" className="w-full" />
                </div>
              )}

              {activeTab === 'text' && (
                <div className="bg-card rounded-xl p-6 space-y-4 max-h-[600px] overflow-y-auto border border-border">
                  {textCount === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-8">No text detected. Try re-analysing with a different AI provider.</p>
                  )}

                  {/* Titles */}
                  {titles.length > 0 && (
                    <div className="space-y-1 pb-3 border-b border-border">
                      {titles.map((t) => (
                        <div key={t.id} className="group relative py-1 px-2 hover:bg-accent/50 rounded cursor-text">
                          <span
                            className={t.bold || t.type === 'title' ? 'font-bold' : ''}
                            style={{
                              fontSize: t.type === 'title' ? '18px' : '15px',
                              color: `#${t.fontColor || '333333'}`,
                            }}
                          >
                            {t.content}
                          </span>
                          <button
                            className="absolute right-1 top-1 text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm"
                            onClick={() => handleDeleteText(t.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sections */}
                  {sections.map((section) => {
                    const sTexts = textsForSection(section.name);
                    if (sTexts.length === 0) return null;
                    return (
                      <div key={section.name}>
                        <h3 className="text-xs font-bold text-accent uppercase tracking-wide border-b border-border pb-1 mb-2">
                          {section.name}
                        </h3>
                        {sTexts.map((t) => (
                          <div key={t.id} className="group relative py-1 px-2 hover:bg-accent/50 rounded cursor-text">
                            <span
                              className={t.bold ? 'font-bold' : ''}
                              style={{
                                fontSize: t.type === 'heading' ? '15px' : t.type === 'label' ? '12px' : '13px',
                                color: `#${t.fontColor || '333333'}`,
                              }}
                            >
                              {t.content}
                            </span>
                            <button
                              className="absolute right-1 top-1 text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm"
                              onClick={() => handleDeleteText(t.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {/* Global */}
                  {globalTexts.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-accent uppercase tracking-wide border-b border-border pb-1 mb-2">
                        Other
                      </h3>
                      {globalTexts.map((t) => (
                        <div key={t.id} className="group relative py-1 px-2 hover:bg-accent/50 rounded cursor-text">
                          <span style={{ fontSize: '13px', color: `#${t.fontColor || '333333'}` }}>
                            {t.content}
                          </span>
                          <button
                            className="absolute right-1 top-1 text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm"
                            onClick={() => handleDeleteText(t.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'images' && (
                <div className="bg-card rounded-xl p-4 border border-border">
                  {imageCount === 0 && (
                    <p className="text-muted-foreground text-sm text-center py-8">No visual components detected.</p>
                  )}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto">
                    {aiResponse.imageRegions.map((img) => (
                      <div key={img.id} className="group relative">
                        {croppedImages[img.id] ? (
                          <img
                            src={croppedImages[img.id]}
                            alt={img.description}
                            className="w-full aspect-square object-contain rounded-lg border border-border hover:border-primary transition-colors bg-white"
                          />
                        ) : (
                          <div className="w-full aspect-square rounded-lg border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
                            {img.description}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 text-center truncate">{img.description}</p>
                        <button
                          className="absolute top-1 right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                          onClick={() => handleDeleteImage(img.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="rounded-xl" onClick={runAnalysis}>
                <RefreshCw className="h-4 w-4 mr-1" /> Re-analyze
              </Button>
              <Button className="rounded-xl bg-success text-success-foreground shadow-lg shadow-success/25 hover:bg-success/90" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" /> Download PPTX
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
