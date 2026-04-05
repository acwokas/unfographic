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
import { ConversionJob } from '@/types/layout';
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

  // Measure canvas width for font scaling
  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasWidth(entry.contentRect.width);
      }
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [job?.status]);

  useEffect(() => {
    if (!job) {
      navigate('/');
      return;
    }
    if (job.status === 'uploading') {
      runAnalysis();
    }
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
      const layout = await analyzeLayout(base64, settings, img.naturalWidth, img.naturalHeight);
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
      toast({ title: 'All done. Your slides are free now. 🎉' });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!job) return null;

  const slideW = job.layout?.slide.width || 10;
  const slideH = job.layout?.slide.height || 5.625;
  // Font scale: container pixels / (slide inches * 72 points per inch)
  const fontScale = canvasWidth / (slideW * 72);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Logo className="text-lg" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Upload
          </Button>
        </div>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left Panel - Original Image */}
        <div className="lg:w-[40%] border-b lg:border-b-0 lg:border-r border-border p-6 flex flex-col">
          <h2 className="font-heading font-semibold text-foreground mb-3 text-sm">Original</h2>
          <div className="flex-1 flex items-center justify-center bg-card rounded-2xl overflow-hidden border border-border">
            <img
              src={job.imageDataUrl}
              alt={job.fileName}
              className="max-w-full max-h-[60vh] object-contain"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center font-light">{job.fileName}</p>
        </div>

        {/* Right Panel - Preview */}
        <div className="lg:w-[60%] p-6 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              {job.status === 'analyzing' ? 'Deconstructing...' : job.status === 'error' ? 'Oops' : 'Detected Elements'}
            </h2>
            {job.layout && (
              <span className="text-xs text-muted-foreground font-light">
                {job.layout.elements.filter(el => el.type === 'text').length} text overlays
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {job.status === 'analyzing' && (
              <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-muted-foreground font-light">Deconstructing... finding every last text box.</p>
              </div>
            )}

            {job.status === 'error' && (
              <div className="text-center space-y-4 max-w-sm">
                <p className="text-destructive font-medium">{job.error}</p>
                <p className="text-muted-foreground text-sm font-light">That didn't work. Try a different image, or check your API key in Settings.</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" className="rounded-xl border-secondary/30 text-accent hover:bg-secondary/15" onClick={runAnalysis}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Try Again
                  </Button>
                  <Button variant="outline" className="rounded-xl border-secondary/30 text-accent hover:bg-secondary/15" onClick={() => navigate('/settings')}>
                    Settings
                  </Button>
                </div>
              </div>
            )}

            {job.status === 'ready' && job.layout && (
              <div
                ref={canvasRef}
                className="relative w-full rounded-xl overflow-hidden border border-border"
                style={{ aspectRatio: `${slideW} / ${slideH}` }}
                onClick={() => { setSelectedId(null); setEditingId(null); }}
              >
                {/* Layer 1: Background image (the original infographic) */}
                <img
                  src={job.imageDataUrl}
                  alt="Background"
                  className="absolute inset-0 w-full h-full object-contain"
                  draggable={false}
                />

                {/* Layer 2: Editable text overlays */}
                {job.layout.elements.filter(el => el.type === 'text').map((el) => {
                  if (el.type !== 'text') return null;
                  const left = `${(el.x / slideW) * 100}%`;
                  const top = `${(el.y / slideH) * 100}%`;
                  const width = `${(el.w / slideW) * 100}%`;
                  const height = `${(el.h / slideH) * 100}%`;
                  const isSelected_ = selectedId === el.id;
                  const isEditing_ = editingId === el.id;

                  return (
                    <div
                      key={el.id}
                      className={`absolute group ${isSelected_ ? 'outline outline-2 outline-primary outline-offset-1' : ''}`}
                      style={{ left, top, width, height }}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); if (editingId !== el.id) setEditingId(null); }}
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingId(el.id); }}
                    >
                      {!isEditing_ ? (
                        <div
                          className="w-full h-full overflow-hidden cursor-text hover:outline-dashed hover:outline-1 hover:outline-primary/60"
                          style={{
                            fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                            fontWeight: el.bold ? 700 : 400,
                            fontStyle: el.italic ? 'italic' : 'normal',
                            color: el.fontColor ? `#${el.fontColor}` : '#000',
                            textAlign: el.align,
                            display: 'flex',
                            alignItems: el.valign === 'top' ? 'flex-start' : el.valign === 'bottom' ? 'flex-end' : 'center',
                            lineHeight: 1.2,
                            wordBreak: 'break-word',
                            padding: '1px 2px',
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
                          className="w-full h-full bg-transparent resize-none outline-none border-2 border-primary rounded"
                          style={{
                            fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                            fontWeight: el.bold ? 700 : 400,
                            color: el.fontColor ? `#${el.fontColor}` : '#000',
                            lineHeight: 1.2,
                            padding: '1px 2px',
                          }}
                        />
                      )}

                      {/* Delete button */}
                      <button
                        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
                        onClick={(e) => { e.stopPropagation(); handleDelete(el.id); }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-6 justify-center">
            {job.status === 'ready' && (
              <>
                <Button variant="outline" className="rounded-xl border-secondary/30 text-accent hover:bg-secondary/15" onClick={runAnalysis}>
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
