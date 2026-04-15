import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Image as ImageIcon,
  RotateCcw,
  Square,
  StickyNote,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "purrboard-mvp-v1";
const DB_NAME = "purrboard-db";
const STORE_NAME = "boards";
const BOARD_RECORD_KEY = "current";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function openBoardDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readBoardState() {
  const db = await openBoardDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(BOARD_RECORD_KEY);

    request.onsuccess = () => {
      resolve(request.result || null);
      db.close();
    };
    request.onerror = () => {
      reject(request.error);
      db.close();
    };
  });
}

async function writeBoardState(payload) {
  const db = await openBoardDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(payload, BOARD_RECORD_KEY);

    request.onsuccess = () => {
      resolve();
      db.close();
    };
    request.onerror = () => {
      reject(request.error);
      db.close();
    };
  });
}

export default function PurrBoardMvpApp() {
  const boardRef = useRef(null);
  const fileInputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [selection, setSelection] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [boardSize, setBoardSize] = useState({ width: 1200, height: 800 });
  const [hasLoadedBoard, setHasLoadedBoard] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadBoard = async () => {
      try {
        const saved = await readBoardState();
        if (!isMounted) return;

        if (saved) {
          setItems(saved.items || []);
          setNotes(saved.notes || []);
          setViewport(saved.viewport || { x: 0, y: 0, scale: 1 });
          setHasLoadedBoard(true);
          return;
        }
      } catch {
        // fall through to legacy localStorage migration
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        if (isMounted) setHasLoadedBoard(true);
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (!isMounted) return;
        setItems(parsed.items || []);
        setNotes(parsed.notes || []);
        setViewport(parsed.viewport || { x: 0, y: 0, scale: 1 });

        try {
          await writeBoardState(parsed);
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // keep legacy cache if IndexedDB is unavailable
        }
      } catch {
        // ignore invalid saved data
      } finally {
        if (isMounted) setHasLoadedBoard(true);
      }
    };

    loadBoard();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedBoard) return;

    const payload = { items, notes, viewport };
    writeBoardState(payload).catch(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore persistence failures so the board keeps working
      }
    });
  }, [hasLoadedBoard, items, notes, viewport]);

  useEffect(() => {
    const resize = () => {
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      setBoardSize({ width: rect.width, height: rect.height });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const toBoardCoords = useCallback(
    (clientX, clientY) => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport]
  );

  const getObjectById = useCallback(
    (id) => items.find((item) => item.id === id) || notes.find((note) => note.id === id),
    [items, notes]
  );

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;

      const centerX = (-viewport.x + boardSize.width / 2) / viewport.scale;
      const centerY = (-viewport.y + boardSize.height / 2) / viewport.scale;

      const nextItems = await Promise.all(
        files.map(
          (file, index) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const img = new window.Image();
                img.onload = () => {
                  const maxW = 260;
                  const ratio = img.width > maxW ? maxW / img.width : 1;
                  resolve({
                    id: uid(),
                    type: "image",
                    name: file.name,
                    src: reader.result,
                    x: centerX + (index % 4) * 40,
                    y: centerY + Math.floor(index / 4) * 40,
                    width: Math.round(img.width * ratio),
                    height: Math.round(img.height * ratio),
                    z: Date.now() + index,
                  });
                };
                img.src = reader.result;
              };
              reader.readAsDataURL(file);
            })
        )
      );

      setItems((prev) => [...prev, ...nextItems]);
    },
    [boardSize.height, boardSize.width, viewport]
  );

  const onDrop = useCallback(
    async (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files?.length) await handleFiles(files);
    },
    [handleFiles]
  );

  const zoomAtPoint = useCallback((clientX, clientY, factor) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;

    setViewport((prev) => {
      const nextScale = clamp(Number((prev.scale * factor).toFixed(2)), 0.3, 3);
      const boardX = (clientX - rect.left - prev.x) / prev.scale;
      const boardY = (clientY - rect.top - prev.y) / prev.scale;

      return {
        x: clientX - rect.left - boardX * nextScale,
        y: clientY - rect.top - boardY * nextScale,
        scale: nextScale,
      };
    });
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const handleWheel = (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      zoomAtPoint(event.clientX, event.clientY, factor);
    };

    board.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      board.removeEventListener("wheel", handleWheel);
    };
  }, [zoomAtPoint]);

  const startItemDrag = (e, id) => {
    e.stopPropagation();
    const point = toBoardCoords(e.clientX, e.clientY);
    const draggedItem = getObjectById(id);
    if (!draggedItem) return;

    const additiveSelection = e.shiftKey || e.ctrlKey || e.metaKey;
    const nextSelection = additiveSelection
      ? selection.includes(id)
        ? selection.filter((selectedId) => selectedId !== id)
        : [...selection, id]
      : selection.includes(id)
        ? selection
        : [id];
    const normalizedSelection = nextSelection.length ? nextSelection : [id];
    const dragIds = draggedItem.groupedIds ? uniqueIds([id, ...draggedItem.groupedIds]) : normalizedSelection;

    setSelection(normalizedSelection);

    setDragging({
      ids: dragIds,
      startPointer: point,
      initialPositions: dragIds.map((itemId) => {
        const obj = getObjectById(itemId);
        return { id: itemId, x: obj.x, y: obj.y };
      }),
    });
  };

  const startImageResize = (e, id, handle) => {
    e.stopPropagation();
    const point = toBoardCoords(e.clientX, e.clientY);
    const image = items.find((item) => item.id === id && item.type === "image");
    if (!image) return;

    setSelection([id]);
    setResizing({
      id,
      handle,
      startPointer: point,
      initial: {
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
      },
      aspectRatio: image.width / image.height,
    });
  };

  const onPointerMove = useCallback(
    (e) => {
      if (resizing) {
        const point = toBoardCoords(e.clientX, e.clientY);
        const { handle, initial, aspectRatio } = resizing;
        const anchorX = handle.includes("w") ? initial.x + initial.width : initial.x;
        const anchorY = handle.includes("n") ? initial.y + initial.height : initial.y;
        const rawWidth = Math.max(48, Math.abs(point.x - anchorX));
        const rawHeight = Math.max(48, Math.abs(point.y - anchorY));
        const dominantByWidth = rawWidth / aspectRatio >= rawHeight;
        const nextWidth = clamp(dominantByWidth ? rawWidth : rawHeight * aspectRatio, 48, 3200);
        const nextHeight = Math.max(48, Math.round(nextWidth / aspectRatio));

        setItems((prev) =>
          prev.map((item) => {
            if (item.id !== resizing.id) return item;

            return {
              ...item,
              x: handle.includes("w") ? anchorX - nextWidth : anchorX,
              y: handle.includes("n") ? anchorY - nextHeight : anchorY,
              width: Math.round(nextWidth),
              height: Math.round(nextHeight),
            };
          })
        );
      } else if (dragging) {
        const point = toBoardCoords(e.clientX, e.clientY);
        const dx = point.x - dragging.startPointer.x;
        const dy = point.y - dragging.startPointer.y;

        setItems((prev) =>
          prev.map((item) => {
            const original = dragging.initialPositions.find((p) => p.id === item.id);
            return original ? { ...item, x: original.x + dx, y: original.y + dy } : item;
          })
        );
        setNotes((prev) =>
          prev.map((note) => {
            const original = dragging.initialPositions.find((p) => p.id === note.id);
            return original ? { ...note, x: original.x + dx, y: original.y + dy } : note;
          })
        );
      } else if (isPanning) {
        setViewport((prev) => ({
          ...prev,
          x: prev.x + e.movementX,
          y: prev.y + e.movementY,
        }));
      } else if (selectionBox) {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        setSelectionBox((prev) => ({ ...prev, x2: e.clientX - rect.left, y2: e.clientY - rect.top }));
      }
    },
    [dragging, isPanning, resizing, selectionBox, toBoardCoords]
  );

  const onPointerUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    setIsPanning(false);

    if (selectionBox) {
      const x1 = Math.min(selectionBox.x1, selectionBox.x2);
      const y1 = Math.min(selectionBox.y1, selectionBox.y2);
      const x2 = Math.max(selectionBox.x1, selectionBox.x2);
      const y2 = Math.max(selectionBox.y1, selectionBox.y2);

      const selectedIds = [...items, ...notes]
        .filter((obj) => {
          const sx = obj.x * viewport.scale + viewport.x;
          const sy = obj.y * viewport.scale + viewport.y;
          const sw = (obj.width || 180) * viewport.scale;
          const sh = (obj.height || 120) * viewport.scale;
          return sx < x2 && sx + sw > x1 && sy < y2 && sy + sh > y1;
        })
        .map((obj) => obj.id);

      setSelection(selectedIds);
      setSelectionBox(null);
    }
  }, [items, notes, selectionBox, viewport]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const zoom = (factor) => {
    setViewport((prev) => ({
      ...prev,
      scale: clamp(Number((prev.scale * factor).toFixed(2)), 0.3, 3),
    }));
  };

  const resetView = () => setViewport({ x: 0, y: 0, scale: 1 });

  const deleteSelected = () => {
    setItems((prev) => prev.filter((item) => !selection.includes(item.id)));
    setNotes((prev) => prev.filter((note) => !selection.includes(note.id)));
    setSelection([]);
  };

  const addNote = () => {
    const centerX = (-viewport.x + boardSize.width / 2) / viewport.scale;
    const centerY = (-viewport.y + boardSize.height / 2) / viewport.scale;
    const note = {
      id: uid(),
      type: "note",
      text: "メモを書く",
      x: centerX,
      y: centerY,
      width: 220,
      height: 140,
      z: Date.now(),
    };
    setNotes((prev) => [...prev, note]);
    setSelection([note.id]);
  };

  const groupSelection = () => {
    if (selection.length < 2) return;
    const objects = [...items, ...notes].filter((obj) => selection.includes(obj.id));
    if (!objects.length) return;

    const minX = Math.min(...objects.map((o) => o.x)) - 20;
    const minY = Math.min(...objects.map((o) => o.y)) - 20;
    const maxX = Math.max(...objects.map((o) => o.x + (o.width || 180))) + 20;
    const maxY = Math.max(...objects.map((o) => o.y + (o.height || 120))) + 20;

    const note = {
      id: uid(),
      type: "group",
      text: "グループ",
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      z: Math.min(...objects.map((o) => o.z || 0)) - 1,
      isGroup: true,
      groupedIds: objects.map((obj) => obj.id),
    };

    setNotes((prev) => [...prev, note]);
    setSelection([note.id]);
  };

  useEffect(() => {
    setNotes((prev) => {
      let changed = false;

      const nextNotes = prev.map((note) => {
        if (!note.isGroup || !note.groupedIds?.length) return note;

        const members = note.groupedIds.map((id) => getObjectById(id)).filter(Boolean);
        if (!members.length) return note;

        const minX = Math.min(...members.map((member) => member.x)) - 20;
        const minY = Math.min(...members.map((member) => member.y)) - 20;
        const maxX = Math.max(...members.map((member) => member.x + (member.width || 180))) + 20;
        const maxY = Math.max(...members.map((member) => member.y + (member.height || 120))) + 20;

        if (
          note.x === minX &&
          note.y === minY &&
          note.width === maxX - minX &&
          note.height === maxY - minY
        ) {
          return note;
        }

        changed = true;
        return {
          ...note,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
      });

      return changed ? nextNotes : prev;
    });
  }, [getObjectById, items, notes]);

  const sortedObjects = useMemo(() => [...notes, ...items].sort((a, b) => (a.z || 0) - (b.z || 0)), [items, notes]);
  return (
    <div className="h-screen w-full bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] text-neutral-900">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-200 bg-white/80 px-5 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <div className="mr-4 flex items-center gap-3">
              <div className="rounded-3xl bg-slate-950 px-4 py-2 text-sm font-semibold tracking-wide text-white shadow-lg">
                PurrBoard
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">画像を集めて、意味をつけて、まとめて動かす</div>
                <div className="text-xs text-slate-500">PureRef の軽さと Milanote の整理感をひとつのボードに</div>
              </div>
            </div>

            <Button onClick={() => fileInputRef.current?.click()} className="rounded-2xl bg-slate-950 px-4 py-2.5 shadow-sm">
              <Upload className="mr-2 h-4 w-4" />
              画像追加
            </Button>
            <Button variant="outline" onClick={addNote} className="rounded-2xl border-slate-300 bg-white px-4 py-2.5">
              <StickyNote className="mr-2 h-4 w-4" />
              メモ
            </Button>
            <Button
              variant="outline"
              onClick={groupSelection}
              className="rounded-2xl border-slate-300 bg-white px-4 py-2.5"
              disabled={selection.length < 2}
            >
              <Square className="mr-2 h-4 w-4" />
              グループ化
            </Button>
            <Button variant="outline" onClick={() => zoom(1.1)} className="rounded-2xl border-slate-300 bg-white px-3 py-2.5" aria-label="zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => zoom(0.9)} className="rounded-2xl border-slate-300 bg-white px-3 py-2.5" aria-label="zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={resetView} className="rounded-2xl border-slate-300 bg-white px-4 py-2.5">
              <RotateCcw className="mr-2 h-4 w-4" />
              リセット
            </Button>
            <Button
              variant="destructive"
              onClick={deleteSelected}
              className="rounded-2xl px-4 py-2.5"
              disabled={!selection.length}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              削除
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                選択 <span className="font-semibold text-slate-900">{selection.length}</span>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                ズーム <span className="font-semibold text-slate-900">{Math.round(viewport.scale * 100)}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1">
          <div
            ref={boardRef}
            className="relative flex-1 overflow-hidden bg-board"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onPointerDown={(e) => {
              if (e.button === 1 || e.altKey || e.shiftKey) {
                setIsPanning(true);
                return;
              }
              const rect = boardRef.current?.getBoundingClientRect();
              if (!rect) return;
              setSelection([]);
              setSelectionBox({
                x1: e.clientX - rect.left,
                y1: e.clientY - rect.top,
                x2: e.clientX - rect.left,
                y2: e.clientY - rect.top,
              });
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                transformOrigin: "0 0",
              }}
            >
              {sortedObjects.map((obj) => {
                const selected = selection.includes(obj.id);

                if (obj.type === "image") {
                  return (
                    <div
                      key={obj.id}
                      data-image-id={obj.id}
                      className={`absolute cursor-grab rounded-[26px] border bg-white transition ${
                        selected
                          ? "border-sky-500 shadow-[0_0_0_3px_rgba(56,189,248,0.85),0_18px_40px_rgba(14,165,233,0.18)]"
                          : "border-white/70 shadow-[0_16px_36px_rgba(15,23,42,0.12)]"
                      }`}
                      style={{ left: obj.x, top: obj.y, width: obj.width, height: obj.height }}
                      onPointerDown={(e) => startItemDrag(e, obj.id)}
                    >
                      <div className="h-full w-full overflow-hidden rounded-[22px]">
                        <img src={obj.src} alt={obj.name} className="h-full w-full object-cover" draggable={false} />
                      </div>
                      {selected && (
                        <>
                          {[
                            { key: "nw", cursor: "nwse-resize", left: -7, top: -7 },
                            { key: "ne", cursor: "nesw-resize", right: -7, top: -7 },
                            { key: "sw", cursor: "nesw-resize", left: -7, bottom: -7 },
                            { key: "se", cursor: "nwse-resize", right: -7, bottom: -7 },
                          ].map((handle) => (
                            <div
                              key={handle.key}
                              data-resize-handle={handle.key}
                              className="absolute h-6 w-6 opacity-0"
                              style={{
                                cursor: handle.cursor,
                                left: handle.left - 1,
                                right: handle.right - 1,
                                top: handle.top - 1,
                                bottom: handle.bottom - 1,
                                zIndex: 2,
                              }}
                              onPointerDown={(e) => startImageResize(e, obj.id, handle.key)}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  );
                }

                if (obj.isGroup) {
                  return (
                    <div
                      key={obj.id}
                      data-group-id={obj.id}
                      className={`absolute rounded-[32px] border-2 border-dashed border-sky-400 bg-sky-100/40 transition ${
                        selected ? "ring-4 ring-sky-300/70 shadow-[0_24px_50px_rgba(14,165,233,0.16)]" : ""
                      }`}
                      style={{ left: obj.x, top: obj.y, width: obj.width, height: obj.height }}
                      onPointerDown={(e) => startItemDrag(e, obj.id)}
                    >
                      <div className="absolute left-3 top-3 rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700 shadow">
                        {obj.text}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={obj.id}
                    className={`absolute rounded-[26px] border p-3 shadow-md transition ${
                      selected
                        ? "border-amber-400 bg-amber-50 ring-4 ring-amber-200/80 shadow-[0_22px_44px_rgba(245,158,11,0.18)]"
                        : "border-amber-200 bg-yellow-50 shadow-[0_14px_28px_rgba(217,119,6,0.10)]"
                    }`}
                    style={{ left: obj.x, top: obj.y, width: obj.width, minHeight: obj.height }}
                    onPointerDown={(e) => startItemDrag(e, obj.id)}
                  >
                    {selected && (
                      <div className="mb-2 inline-flex rounded-full bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow">
                        編集対象
                      </div>
                    )}
                    <textarea
                      value={obj.text}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNotes((prev) => prev.map((note) => (note.id === obj.id ? { ...note, text: value } : note)));
                      }}
                      className="min-h-[96px] w-full resize-none border-none bg-transparent text-sm outline-none"
                    />
                  </div>
                );
              })}
            </div>

            {selectionBox && (
              <div
                className="pointer-events-none absolute border-2 border-blue-400 bg-blue-200/20"
                style={{
                  left: Math.min(selectionBox.x1, selectionBox.x2),
                  top: Math.min(selectionBox.y1, selectionBox.y2),
                  width: Math.abs(selectionBox.x2 - selectionBox.x1),
                  height: Math.abs(selectionBox.y2 - selectionBox.y1),
                }}
              />
            )}

            {!items.length && !notes.length && (
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <Card className="max-w-xl rounded-[32px] border-white/70 bg-white/90 shadow-[0_30px_80px_rgba(15,23,42,0.14)]">
                  <CardContent className="p-9 text-center">
                    <div className="mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-[28px] bg-sky-50 shadow-inner">
                      <ImageIcon className="h-8 w-8 text-sky-500" />
                    </div>
                    <h2 className="mb-2 text-2xl font-semibold text-slate-900">画像を置いて、あとから整理する</h2>
                    <p className="mb-6 text-sm leading-6 text-slate-500">
                      ドラッグ&ドロップで画像を並べて、複数選択でまとめて動かせます。ホイールでズーム、角のハンドルで直感的にリサイズできます。
                    </p>
                    <div className="flex justify-center gap-2">
                      <Button onClick={() => fileInputRef.current?.click()} className="rounded-2xl bg-slate-950 px-4 py-2.5">
                        <FolderOpen className="mr-2 h-4 w-4" />
                        画像を選ぶ
                      </Button>
                      <Button variant="outline" onClick={addNote} className="rounded-2xl border-slate-300 bg-white px-4 py-2.5">
                        <StickyNote className="mr-2 h-4 w-4" />
                        メモを置く
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
