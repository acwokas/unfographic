import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileImage, Settings, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fileToDataUrl } from '@/lib/image-utils';
import { createJob } from '@/lib/jobs';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const MAX_SIZE = 20 * 1024 * 1024;

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const processFile = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload PNG, JPG, WebP, or PDF files.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 20MB.', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);

    try {
      let dataUrl: string;

      if (file.type === 'application/pdf') {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        dataUrl = canvas.toDataURL('image/png');
      } else {
        dataUrl = await fileToDataUrl(file);
      }

      const job = createJob(file, dataUrl);
      navigate(`/convert/${job.id}`);
    } catch (e: any) {
      toast({ title: 'Processing failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [navigate, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <span className="font-heading text-lg font-bold text-foreground">Slide Deconstructor</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
          <Settings className="h-5 w-5" />
        </Button>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="text-center mb-10 max-w-xl">
          <h1 className="font-heading text-4xl font-bold text-foreground mb-3">
            Deconstruct any slide
          </h1>
          <p className="text-muted-foreground text-lg">
            Upload an infographic or slide image and AI will break it into editable PowerPoint objects.
          </p>
        </div>

        {/* Drop Zone */}
        <div
          className={`drop-zone w-full max-w-lg p-12 flex flex-col items-center justify-center gap-4 cursor-pointer ${isDragging ? 'drop-zone-active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          {isProcessing ? (
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-muted-foreground text-sm">Processing file...</p>
            </div>
          ) : (
            <>
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Upload className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-heading font-semibold text-foreground">Drop your file here</p>
                <p className="text-muted-foreground text-sm mt-1">or click to browse</p>
              </div>
              <div className="flex gap-2 mt-2">
                {['PNG', 'JPG', 'WebP', 'PDF'].map((ext) => (
                  <span key={ext} className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground">
                    {ext}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-4">Max file size: 20MB</p>

        <input
          id="file-input"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          className="hidden"
          onChange={handleFileInput}
        />
      </main>
    </div>
  );
}
