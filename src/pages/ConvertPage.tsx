import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, RefreshCw, Layers, X, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getJob, updateJob } from '@/lib/jobs';
import { loadSettings } from '@/lib/settings';
import { analyzeLayout } from '@/lib/analyze';
import { resizeImageForApi, loadImage } from '@/lib/image-utils';
import { generatePptx } from '@/lib/pptx-generator';
import { ConversionJob, LayoutElement } from '@/types/layout';

export default function ConvertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [job, setJob] = useState<ConversionJob | undefined>(id ? getJob(id) : undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    if (!settings.apiKey) {
      toast({ title: 'No API key', description: 'Please configure your API key in Settings.', variant: 'destructive' });
      updateJob(id, { status: 'error', error: 'No API key configured' });
      setJob({ ...job, status: 'error', error: 'No API key configured' });
      return;
    }

    updateJob(id, { status: 'analyzing' });
    setJob((prev) => prev ? { ...prev, status: 'analyzing' } : prev);

    try {
      const resized = await resizeImageForApi(job.imageDataUrl);
      const base64 = resized.split(',')[1];
      const layout = await analyzeLayout(base64, settings);
      const img = await loadImage(job.imageDataUrl);
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
      await generatePptx(job.layout, job.originalImage, `${job.fileName.split('.')[0]}.pptx`);
      toast({ title: 'PPTX downloaded!' });
    } catch (e: any) {
      toast({ title: 'Generation failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!job) return null;

  const slideW = job.layout?.slide.width || 10;
  const slideH = job.layout?.slide.height || 5.625;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <span className="font-heading text-lg font-bold text-foreground">Slide Deconstructor</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Upload
          </Button>
        </div>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left Panel - Original Image */}
        <div className="lg:w-[40%] border-b lg:border-b-0 lg:border-r border-border p-6 flex flex-col">
          <h2 className="font-heading font-semibold text-foreground mb-3 text-sm">Original</h2>
          <div className="flex-1 flex items-center justify-center bg-secondary/50 rounded-xl overflow-hidden">
            <img
              src={job.imageDataUrl}
              alt={job.fileName}
              className="max-w-full max-h-[60vh] object-contain"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">{job.fileName}</p>
        </div>

        {/* Right Panel - Preview */}
        <div className="lg:w-[60%] p-6 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              {job.status === 'analyzing' ? 'Analyzing layout...' : job.status === 'error' ? 'Error' : 'Detected Elements'}
            </h2>
            {job.layout && (
              <span className="text-xs text-muted-foreground">
                {job.layout.elements.length} elements
              </span>
            )}
          </div>

          <div className="flex-1 flex items-center justify-center">
            {job.status === 'analyzing' && (
              <div className="flex flex-col items-center gap-4">
                <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                <p className="text-muted-foreground">AI is analyzing your image...</p>
              </div>
            )}

            {job.status === 'error' && (
              <div className="text-center space-y-4">
                <p className="text-destructive font-medium">{job.error}</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={runAnalysis}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Try Again
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/settings')}>
                    Settings
                  </Button>
                </div>
              </div>
            )}

            {job.status === 'ready' && job.layout && (
              <div
                className="canvas-container relative w-full"
                style={{
                  maxWidth: '100%',
                  aspectRatio: `${slideW} / ${slideH}`,
                  backgroundColor: job.layout.slide.backgroundColor || '#ffffff',
                }}
                onClick={() => { setSelectedId(null); setEditingId(null); }}
              >
                {job.layout.elements.map((el) => (
                  <ElementOverlay
                    key={el.id}
                    element={el}
                    slideWidth={slideW}
                    slideHeight={slideH}
                    isSelected={selectedId === el.id}
                    isEditing={editingId === el.id}
                    onSelect={(e) => { e.stopPropagation(); setSelectedId(el.id); setEditingId(null); }}
                    onDoubleClick={(e) => { e.stopPropagation(); if (el.type === 'text') setEditingId(el.id); }}
                    onDelete={() => handleDelete(el.id)}
                    onEditText={(text) => handleEditText(el.id, text)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-6 justify-center">
            {job.status === 'ready' && (
              <>
                <Button variant="outline" onClick={runAnalysis}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Re-analyze
                </Button>
                <Button onClick={handleDownload}>
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

function ElementOverlay({
  element,
  slideWidth,
  slideHeight,
  isSelected,
  isEditing,
  onSelect,
  onDoubleClick,
  onDelete,
  onEditText,
}: {
  element: LayoutElement;
  slideWidth: number;
  slideHeight: number;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onEditText: (text: string) => void;
}) {
  const left = `${(element.x / slideWidth) * 100}%`;
  const top = `${(element.y / slideHeight) * 100}%`;
  const width = `${(element.w / slideWidth) * 100}%`;
  const height = `${(element.h / slideHeight) * 100}%`;

  return (
    <div
      className={`element-preview absolute group ${isSelected ? 'element-preview-selected' : ''}`}
      style={{ left, top, width, height }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {/* Content */}
      {element.type === 'text' && !isEditing && (
        <div
          className="w-full h-full flex overflow-hidden px-1"
          style={{
            fontSize: `clamp(6px, ${(element.fontSize / slideHeight) * 100}vh, 24px)`,
            fontWeight: element.bold ? 'bold' : 'normal',
            fontStyle: element.italic ? 'italic' : 'normal',
            color: element.fontColor || '#000',
            textAlign: element.align,
            alignItems: element.valign === 'top' ? 'flex-start' : element.valign === 'bottom' ? 'flex-end' : 'center',
            backgroundColor: element.backgroundColor || 'transparent',
          }}
        >
          <span className="w-full leading-tight">{element.content}</span>
        </div>
      )}

      {element.type === 'text' && isEditing && (
        <textarea
          className="w-full h-full p-1 bg-card text-foreground border-2 border-primary resize-none text-xs focus:outline-none"
          defaultValue={element.content}
          autoFocus
          onBlur={(e) => onEditText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {element.type === 'image_region' && (
        <div className="w-full h-full bg-secondary/60 flex items-center justify-center">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[80%]">{element.description}</span>
        </div>
      )}

      {element.type === 'shape' && (
        <div
          className="w-full h-full"
          style={{
            backgroundColor: element.fillColor || 'transparent',
            border: element.borderColor ? `${element.borderWidth || 1}px solid ${element.borderColor}` : 'none',
            borderRadius: element.shapeType === 'ellipse' ? '50%' : element.shapeType === 'roundRect' ? '8px' : '0',
          }}
        />
      )}

      {/* Delete button */}
      <button
        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
