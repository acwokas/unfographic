import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getJob, updateJob } from '@/lib/jobs';
import { loadSettings } from '@/lib/settings';
import { analyzeLayout } from '@/lib/analyze';
import { resizeImageForApi, loadImage } from '@/lib/image-utils';
import { generatePptx } from '@/lib/pptx-generator';
import { buildSlideLayout } from '@/lib/layout-engine';
import { ConversionJob, LayoutElement } from '@/types/layout';
import Logo from '@/components/Logo';

export default function ConvertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [job, setJob] = useState<ConversionJob | undefined>(id ? getJob(id) : undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [job?.status]);

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

      const aiResponse = await analyzeLayout(base64, settings, img.naturalWidth, img.naturalHeight);
      const layout = buildSlideLayout(aiResponse, img);

      updateJob(id, { status: 'ready', layout, originalImage: img });
      setJob((prev) => prev ? { ...prev, status: 'ready', layout, originalImage: img } : prev);
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
    if (selectedId === elId) setSelectedId(null);
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

  const handleDownload = async () => {
    if (!job?.layout || !job.originalImage) return;
    try {
      await generatePptx(job.layout, job.originalImage, 'unfographic-export.pptx');
      toast({ title: 'All done. Your slides are free now.' });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!job) return null;

  const slideW = job.layout?.slide.width || 10;
  const slideH = job.layout?.slide.height || 5.625;
  const fontScale = canvasWidth / (slideW * 72);

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
                {textCount} text \u00b7 {imageCount} images
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {job.status === 'analyzing' && (
              <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-muted-foreground font-light">Deconstructing\u2026 extracting every element.</p>
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
              <div
                ref={canvasRef}
                className="relative w-full rounded-xl overflow-hidden border border-border"
                style={{
                  aspectRatio: `${slideW} / ${slideH}`,
                  backgroundImage: `url(${job.imageDataUrl})`,
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
                onClick={() => { setSelectedId(null); setEditingId(null); }}
              >
                {job.layout.elements.map((el) => {
                  const left = `${(el.x / slideW) * 100}%`;
                  const top = `${(el.y / slideH) * 100}%`;
                  const width = `${(el.w / slideW) * 100}%`;
                  const height = `${(el.h / slideH) * 100}%`;
                  const isSelected = selectedId === el.id;
                  const isEditing = editingId === el.id;

                  if (el.type === 'image_region') {
                    return (
                      <div
                        key={el.id}
                        className={`absolute group ${isSelected ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-primary/40'}`}
                        style={{ left, top, width, height }}
                        onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}
                      >
                        {el.croppedDataUrl ? (
                          <img src={el.croppedDataUrl} alt={el.description} className="w-full h-full object-contain" draggable={false} />
                        ) : (
                          <div className="w-full h-full bg-muted/70 flex items-center justify-center text-xs text-muted-foreground p-1 text-center rounded">
                            {el.description}
                          </div>
                        )}
                        <button
                          className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
                          onClick={(e) => { e.stopPropagation(); handleDelete(el.id); }}
                        ><X className="h-3 w-3" /></button>
                      </div>
                    );
                  }

                  if (el.type === 'text') {
                    return (
                      <div
                        key={el.id}
                        className={`absolute group ${isSelected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40'}`}
                        style={{
                          left, top, width, height,
                          backgroundColor: 'rgba(255, 255, 255, 0.92)',
                          borderRadius: '2px',
                          padding: '1px 3px',
                        }}
                        onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); if (editingId !== el.id) setEditingId(null); }}
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(el.id); }}
                      >
                        {!isEditing ? (
                          <div
                            className="w-full h-full overflow-hidden cursor-text"
                            style={{
                              fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                              fontWeight: el.bold ? 700 : 400,
                              fontStyle: el.italic ? 'italic' : 'normal',
                              color: `#${el.fontColor || '000'}`,
                              textAlign: el.align,
                              display: 'flex',
                              alignItems: el.valign === 'top' ? 'flex-start' : el.valign === 'bottom' ? 'flex-end' : 'center',
                              lineHeight: 1.2,
                              wordBreak: 'break-word',
                            }}
                          >
                            <span className="w-full">{el.content}</span>
                          </div>
                        ) : (
                          <textarea
                            autoFocus
                            defaultValue={el.content}
                            onBlur={(e) => { handleEditText(el.id, e.target.value); setEditingId(null); }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full h-full bg-white resize-none outline-none border-2 border-primary rounded"
                            style={{
                              fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                              fontWeight: el.bold ? 700 : 400,
                              color: `#${el.fontColor || '000'}`,
                              lineHeight: 1.2,
                            }}
                          />
                        )}
                        <button
                          className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
                          onClick={(e) => { e.stopPropagation(); handleDelete(el.id); }}
                        ><X className="h-3 w-3" /></button>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
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
