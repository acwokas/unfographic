import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getJob, updateJob } from '@/lib/jobs';
import { loadSettings } from '@/lib/settings';
import { analyzeLayout } from '@/lib/analyze';
import { resizeImageForApi, loadImage } from '@/lib/image-utils';
import { createCleanBackground } from '@/lib/inpaint';
import { generatePptx } from '@/lib/pptx-generator';
import { buildSlideLayout } from '@/lib/layout-engine';
import { ConversionJob } from '@/types/layout';
import Logo from '@/components/Logo';
import SlidePreview from '@/components/SlidePreview';

export default function ConvertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [job, setJob] = useState<ConversionJob | undefined>(id ? getJob(id) : undefined);

  useEffect(() => {
    if (!job) { navigate('/'); return; }
    if (job.status === 'uploading') runAnalysis();
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

      const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      const aiResponse = await analyzeLayout(
        base64, settings,
        Math.round(img.naturalWidth * scale),
        Math.round(img.naturalHeight * scale),
      );

      const aiImgW = aiResponse.imageWidth || Math.round(img.naturalWidth * scale);
      const aiImgH = aiResponse.imageHeight || Math.round(img.naturalHeight * scale);
      const bboxScaleX = img.naturalWidth / aiImgW;
      const bboxScaleY = img.naturalHeight / aiImgH;

      for (const tb of (aiResponse.textBlocks || [])) {
        if (tb.boundingBox) {
          tb.boundingBox.x = Math.round(tb.boundingBox.x * bboxScaleX);
          tb.boundingBox.y = Math.round(tb.boundingBox.y * bboxScaleY);
          tb.boundingBox.width = Math.round(tb.boundingBox.width * bboxScaleX);
          tb.boundingBox.height = Math.round(tb.boundingBox.height * bboxScaleY);
        }
      }
      for (const ir of (aiResponse.imageRegions || [])) {
        ir.cropBox.x = Math.round(ir.cropBox.x * bboxScaleX);
        ir.cropBox.y = Math.round(ir.cropBox.y * bboxScaleY);
        ir.cropBox.width = Math.round(ir.cropBox.width * bboxScaleX);
        ir.cropBox.height = Math.round(ir.cropBox.height * bboxScaleY);
      }

      aiResponse.imageWidth = img.naturalWidth;
      aiResponse.imageHeight = img.naturalHeight;

      const layout = buildSlideLayout(aiResponse, img);
      const cleanBgDataUrl = createCleanBackground(img, aiResponse.textBlocks || []);

      updateJob(id, { status: 'ready', layout, originalImage: img, cleanBgDataUrl });
      setJob((prev) => prev ? { ...prev, status: 'ready', layout, originalImage: img, cleanBgDataUrl } : prev);
    } catch (e: any) {
      updateJob(id, { status: 'error', error: e.message });
      setJob((prev) => prev ? { ...prev, status: 'error', error: e.message } : prev);
      toast({ title: 'Analysis failed', description: e.message, variant: 'destructive' });
    }
  }, [job, id, toast]);

  const handleDelete = (elId: string) => {
    if (!job?.layout || !id) return;
    const newElements = job.layout.elements.filter((el) => el.id !== elId);
    const newLayout = { ...job.layout, elements: newElements };
    updateJob(id, { layout: newLayout });
    setJob((prev) => prev ? { ...prev, layout: newLayout } : prev);
  };

  const handleEditText = (elId: string, newContent: string) => {
    if (!job?.layout || !id) return;
    const newElements = job.layout.elements.map((el) =>
      el.id === elId && el.type === 'text' ? { ...el, content: newContent } : el
    );
    const newLayout = { ...job.layout, elements: newElements };
    updateJob(id, { layout: newLayout });
    setJob((prev) => prev ? { ...prev, layout: newLayout } : prev);
  };

  const handleMoveElement = useCallback((elId: string, newX: number, newY: number) => {
    if (!job?.layout || !id) return;
    const newElements = job.layout.elements.map((el) =>
      el.id === elId ? { ...el, x: newX, y: newY } : el
    );
    const newLayout = { ...job.layout, elements: newElements };
    // Update state only (don't persist every mousemove)
    setJob((prev) => prev ? { ...prev, layout: newLayout } : prev);
  }, [job?.layout, id]);

  const handleDownload = async () => {
    if (!job?.layout || !job.originalImage) return;
    // Persist latest positions before download
    if (id && job.layout) updateJob(id, { layout: job.layout });
    try {
      await generatePptx(job.layout, job.originalImage, 'unfographic-export.pptx', job.cleanBgDataUrl);
      toast({ title: 'All done. Your slides are free now.' });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!job) return null;

  const textCount = job.layout?.elements.filter(el => el.type === 'text').length || 0;
  const imageCount = job.layout?.elements.filter(el => el.type === 'image_region').length || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Logo className="text-lg" />
        <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Upload
        </Button>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left Panel - Original Image */}
        <div className="lg:w-[40%] border-b lg:border-b-0 lg:border-r border-border p-6 flex flex-col">
          <h2 className="font-heading font-semibold text-foreground mb-3 text-sm">Original</h2>
          <div className="flex-1 flex items-center justify-center bg-card rounded-2xl overflow-hidden border border-border">
            <img src={job.imageDataUrl} alt={job.fileName} className="max-w-full max-h-[60vh] object-contain" />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center font-light">{job.fileName}</p>
        </div>

        {/* Right Panel - Reconstructed Preview */}
        <div className="lg:w-[60%] p-6 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              {job.status === 'analyzing' ? 'Deconstructing...' : job.status === 'error' ? 'Oops' : 'Reconstructed Layout'}
            </h2>
            {job.layout && (
              <span className="text-xs text-muted-foreground font-light">
                {textCount} text · {imageCount} images · drag to reposition
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {job.status === 'analyzing' && (
              <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-muted-foreground font-light">Deconstructing… extracting every element.</p>
              </div>
            )}

            {job.status === 'error' && (
              <div className="text-center space-y-4 max-w-sm">
                <p className="text-destructive font-medium">{job.error}</p>
                <p className="text-muted-foreground text-sm font-light">Try a different image, or check your API key in Settings.</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" className="rounded-xl" onClick={runAnalysis}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Try Again
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => navigate('/settings')}>Settings</Button>
                </div>
              </div>
            )}

            {job.status === 'ready' && job.layout && (
              <SlidePreview
                layout={job.layout}
                backgroundUrl={job.cleanBgDataUrl || job.imageDataUrl}
                onDeleteElement={handleDelete}
                onEditText={handleEditText}
                onMoveElement={handleMoveElement}
              />
            )}
          </div>

          <div className="flex gap-3 mt-6 justify-center">
            {job.status === 'ready' && (
              <>
                <Button variant="outline" className="rounded-xl" onClick={runAnalysis}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Re-analyze
                </Button>
                <Button className="rounded-xl bg-success text-success-foreground shadow-lg shadow-success/25 hover:bg-success/90" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" /> Download PPTX
                </Button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
