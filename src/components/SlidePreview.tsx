import { useRef, useState, useCallback, useEffect } from 'react';
import { X, Move } from 'lucide-react';
import { LayoutAnalysis, LayoutElement } from '@/types/layout';

interface SlidePreviewProps {
  layout: LayoutAnalysis;
  backgroundUrl: string;
  onDeleteElement: (id: string) => void;
  onEditText: (id: string, content: string) => void;
  onMoveElement: (id: string, x: number, y: number) => void;
}

export default function SlidePreview({
  layout,
  backgroundUrl,
  onDeleteElement,
  onEditText,
  onMoveElement,
}: SlidePreviewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    startMouseX: number;
    startMouseY: number;
    startElX: number;
    startElY: number;
  } | null>(null);

  const slideW = layout.slide.width;
  const slideH = layout.slide.height;
  const fontScale = canvasWidth / (slideW * 72);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, el: LayoutElement) => {
      e.stopPropagation();
      e.preventDefault();
      setSelectedId(el.id);
      setEditingId(null);
      setDragging({
        id: el.id,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startElX: el.x,
        startElY: el.y,
      });
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      // Convert pixel delta to slide inches
      const dx = ((e.clientX - dragging.startMouseX) / rect.width) * slideW;
      const dy = ((e.clientY - dragging.startMouseY) / rect.height) * slideH;

      const el = layout.elements.find((el) => el.id === dragging.id);
      if (!el) return;

      const newX = Math.max(0, Math.min(dragging.startElX + dx, slideW - el.w));
      const newY = Math.max(0, Math.min(dragging.startElY + dy, slideH - el.h));
      onMoveElement(dragging.id, newX, newY);
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, layout.elements, onMoveElement, slideW, slideH]);

  return (
    <div
      ref={canvasRef}
      className="relative rounded-xl overflow-hidden border border-border mx-auto"
      style={{
        width: '100%',
        maxHeight: '65vh',
        maxWidth: `${(65 * slideW) / slideH}vh`,
        aspectRatio: `${slideW} / ${slideH}`,
        backgroundImage: `url(${backgroundUrl})`,
        backgroundSize: '100% 100%',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
      onClick={() => {
        setSelectedId(null);
        setEditingId(null);
      }}
    >
      {layout.elements.map((el) => {
        const left = `${(el.x / slideW) * 100}%`;
        const top = `${(el.y / slideH) * 100}%`;
        const width = `${(el.w / slideW) * 100}%`;
        const height = `${(el.h / slideH) * 100}%`;
        const isSelected = selectedId === el.id;
        const isEditing = editingId === el.id;
        const isDragging = dragging?.id === el.id;

        if (el.type === 'image_region') {
          return (
            <div
              key={el.id}
              className={`absolute group cursor-move ${
                isSelected ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-primary/40'
              } ${isDragging ? 'opacity-80' : ''}`}
              style={{ left, top, width, height }}
              onMouseDown={(e) => handleMouseDown(e, el)}
            >
              {el.croppedDataUrl ? (
                <img
                  src={el.croppedDataUrl}
                  alt={el.description}
                  className="w-full h-full object-contain pointer-events-none"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full bg-muted/70 flex items-center justify-center text-xs text-muted-foreground p-1 text-center rounded pointer-events-none">
                  {el.description}
                </div>
              )}
              {isSelected && (
                <div className="absolute -top-3 -left-3 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs z-10">
                  <Move className="h-3 w-3" />
                </div>
              )}
              <button
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteElement(el.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        }

        if (el.type === 'text') {
          return (
            <div
              key={el.id}
              className={`absolute group ${
                isSelected ? 'ring-2 ring-primary cursor-move' : 'hover:ring-1 hover:ring-primary/40 cursor-move'
              } ${isDragging ? 'opacity-80' : ''}`}
              style={{
                left,
                top,
                width,
                height,
                borderRadius: '2px',
                padding: '0px 1px',
              }}
              onMouseDown={(e) => {
                if (editingId === el.id) return; // don't drag while editing
                handleMouseDown(e, el);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(el.id);
                setDragging(null);
              }}
            >
              {!isEditing ? (
                <div
                  className="w-full h-full overflow-hidden pointer-events-none"
                  style={{
                    fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                    fontWeight: el.bold ? 700 : 400,
                    fontStyle: el.italic ? 'italic' : 'normal',
                    color: `#${el.fontColor || '000'}`,
                    textAlign: el.align,
                    display: 'flex',
                    alignItems:
                      el.valign === 'top'
                        ? 'flex-start'
                        : el.valign === 'bottom'
                        ? 'flex-end'
                        : 'center',
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
                  onBlur={(e) => {
                    onEditText(el.id, e.target.value);
                    setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full h-full bg-white resize-none outline-none border-2 border-primary rounded"
                  style={{
                    fontSize: `${Math.max(6, el.fontSize * fontScale)}px`,
                    fontWeight: el.bold ? 700 : 400,
                    color: `#${el.fontColor || '000'}`,
                    lineHeight: 1.2,
                  }}
                />
              )}
              {isSelected && !isEditing && (
                <div className="absolute -top-3 -left-3 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs z-10">
                  <Move className="h-3 w-3" />
                </div>
              )}
              <button
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground hidden group-hover:flex items-center justify-center text-xs z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteElement(el.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
