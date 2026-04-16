import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Image as ImageIcon,
  Moon,
  RotateCcw,
  Square,
  StickyNote,
  Sun,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "refolio-v1";
const THEME_KEY = "refolio-theme";
const DB_NAME = "refolio-db";
const STORE_NAME = "boards";
const BOARD_RECORD_KEY = "current";
const MIN_SCALE = 0.01;
const ARRANGE_GAP = 0;
const NOTE_PLACEHOLDER = "メモを書く";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampMin(value, min) {
  return Math.max(min, value);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function getSelectionBounds(objects) {
  return {
    minX: Math.min(...objects.map((obj) => obj.x)),
    minY: Math.min(...objects.map((obj) => obj.y)),
    maxX: Math.max(...objects.map((obj) => obj.x + (obj.width || 0))),
    maxY: Math.max(...objects.map((obj) => obj.y + (obj.height || 0))),
  };
}

function createGridArrangement(images) {
  return createPackedArrangement(images);
}

function createPackedArrangement(images) {
  const totalArea = images.reduce((sum, image) => sum + image.width * image.height, 0);
  const widestImage = Math.max(...images.map((image) => image.width));
  const tallestImage = Math.max(...images.map((image) => image.height));
  const preferredWidth = Math.round(Math.sqrt(totalArea) * 1.18);
  const balancingWidth = Math.round(Math.sqrt(images.length) * ((widestImage + tallestImage) / 2) * 0.42);
  const targetWidth = Math.max(420, widestImage, preferredWidth + balancingWidth);
  const hardWrapWidth = Math.round(targetWidth * 1.12);

  const sortedImages = [...images].sort((a, b) => {
    const longestEdgeDiff = Math.max(b.width, b.height) - Math.max(a.width, a.height);
    if (longestEdgeDiff !== 0) return longestEdgeDiff;

    const areaDiff = b.width * b.height - a.width * a.height;
    if (areaDiff !== 0) return areaDiff;

    return b.height - a.height;
  });

  const placed = [];

  const overlaps = (candidate, rect) =>
    candidate.x < rect.x + rect.width &&
    candidate.x + candidate.width > rect.x &&
    candidate.y < rect.y + rect.height &&
    candidate.y + candidate.height > rect.y;

  sortedImages.forEach((image) => {
    const candidates = [{ x: 0, y: 0 }];

    placed.forEach((rect) => {
      candidates.push({ x: rect.x + rect.width + ARRANGE_GAP, y: rect.y });
      candidates.push({ x: rect.x, y: rect.y + rect.height + ARRANGE_GAP });
    });

    const uniqueCandidates = [...new Map(candidates.map((point) => [`${point.x}:${point.y}`, point])).values()]
      .filter((point) => point.x >= 0 && point.y >= 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    let bestPlacement = null;
    let bestScore = Number.POSITIVE_INFINITY;

    uniqueCandidates.forEach((point) => {
      const candidate = {
        id: image.id,
        x: point.x,
        y: point.y,
        width: image.width,
        height: image.height,
      };

      if (placed.some((rect) => overlaps(candidate, rect))) return;

      const nextWidth = Math.max(0, ...placed.map((rect) => rect.x + rect.width), candidate.x + candidate.width);
      const nextHeight = Math.max(0, ...placed.map((rect) => rect.y + rect.height), candidate.y + candidate.height);
      if (nextWidth > hardWrapWidth) return;

      const widthPenalty = Math.max(0, nextWidth - targetWidth);
      const emptyAreaPenalty = nextWidth * nextHeight - (placed.reduce((sum, rect) => sum + rect.width * rect.height, 0) + image.width * image.height);
      const edgeContact = placed.reduce((sum, rect) => {
        const verticalTouch =
          (candidate.x + candidate.width === rect.x || rect.x + rect.width === candidate.x) &&
          Math.min(candidate.y + candidate.height, rect.y + rect.height) > Math.max(candidate.y, rect.y);
        const horizontalTouch =
          (candidate.y + candidate.height === rect.y || rect.y + rect.height === candidate.y) &&
          Math.min(candidate.x + candidate.width, rect.x + rect.width) > Math.max(candidate.x, rect.x);
        return sum + (verticalTouch ? 1 : 0) + (horizontalTouch ? 1 : 0);
      }, 0);

      const score =
        candidate.y * 220 +
        candidate.x * 8 +
        widthPenalty * 140 +
        Math.abs(nextWidth - targetWidth) * 0.4 +
        nextHeight * 1.6 +
        emptyAreaPenalty * 0.02 -
        edgeContact * 120;

      if (score < bestScore) {
        bestScore = score;
        bestPlacement = candidate;
      }
    });

    if (!bestPlacement) {
      const boundsWidth = Math.max(0, ...placed.map((rect) => rect.x + rect.width));
      bestPlacement = {
        id: image.id,
        x: boundsWidth === 0 ? 0 : boundsWidth + ARRANGE_GAP,
        y: 0,
        width: image.width,
        height: image.height,
      };
    }

    placed.push(bestPlacement);
  });

  return placed.map(({ id, x, y }) => ({ id, x, y }));
}

function getSelectionIdsFromBox(selectionBox, objects, viewport) {
  if (!selectionBox) return [];

  const x1 = Math.min(selectionBox.x1, selectionBox.x2);
  const y1 = Math.min(selectionBox.y1, selectionBox.y2);
  const x2 = Math.max(selectionBox.x1, selectionBox.x2);
  const y2 = Math.max(selectionBox.y1, selectionBox.y2);

  return objects
    .filter((obj) => {
      const sx = obj.x * viewport.scale + viewport.x;
      const sy = obj.y * viewport.scale + viewport.y;
      const sw = (obj.width || 180) * viewport.scale;
      const sh = (obj.height || 120) * viewport.scale;
      return sx < x2 && sx + sw > x1 && sy < y2 && sy + sh > y1;
    })
    .map((obj) => obj.id);
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

export default function RefolioApp() {
  const boardRef = useRef(null);
  const fileInputRef = useRef(null);
  const panStateRef = useRef(null);
  const moveFrameRef = useRef(null);
  const pointerSampleRef = useRef(null);

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
  const [theme, setTheme] = useState("light");
  const [editingNoteId, setEditingNoteId] = useState(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      return;
    }

    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

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
        // fall through to localStorage migration
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
      const nextScale = clampMin(Number((prev.scale * factor).toFixed(4)), MIN_SCALE);
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
    return () => board.removeEventListener("wheel", handleWheel);
  }, [zoomAtPoint]);

  const startPan = useCallback(
    (clientX, clientY) => {
      panStateRef.current = {
        startClientX: clientX,
        startClientY: clientY,
        startViewportX: viewport.x,
        startViewportY: viewport.y,
      };
      setIsPanning(true);
    },
    [viewport.x, viewport.y]
  );

  const startItemDrag = (e, id) => {
    e.stopPropagation();
    if (e.button === 1 || e.altKey) {
      startPan(e.clientX, e.clientY);
      return;
    }

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
    if (e.button === 1 || e.altKey) {
      startPan(e.clientX, e.clientY);
      return;
    }

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

  const flushPointerMove = useCallback(() => {
    moveFrameRef.current = null;
    const sample = pointerSampleRef.current;
    if (!sample) return;

    if (resizing) {
      const point = toBoardCoords(sample.clientX, sample.clientY);
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
        const point = toBoardCoords(sample.clientX, sample.clientY);
        const dx = point.x - dragging.startPointer.x;
        const dy = point.y - dragging.startPointer.y;

        setItems((prev) =>
          prev.map((item) => {
            const original = dragging.initialPositions.find((entry) => entry.id === item.id);
            return original ? { ...item, x: original.x + dx, y: original.y + dy } : item;
          })
        );

        setNotes((prev) =>
          prev.map((note) => {
            const original = dragging.initialPositions.find((entry) => entry.id === note.id);
            return original ? { ...note, x: original.x + dx, y: original.y + dy } : note;
          })
        );
      } else if (isPanning) {
        const panState = panStateRef.current;
        if (!panState) return;

        const dx = sample.clientX - panState.startClientX;
        const dy = sample.clientY - panState.startClientY;
        setViewport((prev) => ({
          ...prev,
          x: panState.startViewportX + dx,
          y: panState.startViewportY + dy,
        }));
      } else if (selectionBox) {
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        setSelectionBox((prev) => ({
          ...prev,
          x2: sample.clientX - rect.left,
          y2: sample.clientY - rect.top,
        }));
      }
  }, [dragging, isPanning, resizing, selectionBox, toBoardCoords]);

  const onPointerMove = useCallback(
    (e) => {
      pointerSampleRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
    },
    [flushPointerMove]
  );

  const onPointerUp = useCallback(() => {
    if (moveFrameRef.current !== null) {
      window.cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    pointerSampleRef.current = null;
    setDragging(null);
    setResizing(null);
    setIsPanning(false);
    panStateRef.current = null;

    if (selectionBox) {
      const selectedIds = getSelectionIdsFromBox(selectionBox, [...items, ...notes], viewport);
      setSelection(selectedIds);
      setSelectionBox(null);
    }
  }, [items, notes, selectionBox, viewport]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const zoom = (factor) => {
    setViewport((prev) => ({
      ...prev,
      scale: clampMin(Number((prev.scale * factor).toFixed(4)), MIN_SCALE),
    }));
  };

  const resetView = () => setViewport({ x: 0, y: 0, scale: 1 });

  const deleteSelected = () => {
    setItems((prev) => prev.filter((item) => !selection.includes(item.id)));
    setNotes((prev) => prev.filter((note) => !selection.includes(note.id)));
    setEditingNoteId((prev) => (selection.includes(prev) ? null : prev));
    setSelection([]);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || !selection.length) return;

      const target = event.target;
      const tagName = target?.tagName;
      const isEditable =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isEditable) return;

      event.preventDefault();
      deleteSelected();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection]);

  const addNote = () => {
    const centerX = (-viewport.x + boardSize.width / 2) / viewport.scale;
    const centerY = (-viewport.y + boardSize.height / 2) / viewport.scale;
    const note = {
      id: uid(),
      type: "note",
      text: "",
      x: centerX,
      y: centerY,
      width: 220,
      height: 140,
      z: Date.now(),
    };

    setNotes((prev) => [...prev, note]);
    setSelection([note.id]);
    setEditingNoteId(note.id);
  };

  const groupSelection = () => {
    if (selection.length < 2) return;

    const objects = [...items, ...notes].filter((obj) => selection.includes(obj.id));
    if (!objects.length) return;

    const minX = Math.min(...objects.map((obj) => obj.x)) - 20;
    const minY = Math.min(...objects.map((obj) => obj.y)) - 20;
    const maxX = Math.max(...objects.map((obj) => obj.x + (obj.width || 180))) + 20;
    const maxY = Math.max(...objects.map((obj) => obj.y + (obj.height || 120))) + 20;

    const group = {
      id: uid(),
      type: "group",
      text: "グループ",
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      z: Math.min(...objects.map((obj) => obj.z || 0)) - 1,
      isGroup: true,
      groupedIds: objects.map((obj) => obj.id),
    };

    setNotes((prev) => [...prev, group]);
    setSelection([group.id]);
  };

  const arrangeSelection = () => {
    const selectedImages = items
      .filter((item) => item.type === "image" && selection.includes(item.id))
      .sort((a, b) => (a.z || 0) - (b.z || 0));

    if (selectedImages.length < 2) return;

    const sourceBounds = getSelectionBounds(selectedImages);
    const nextPositions = createGridArrangement(selectedImages);

    const arrangedById = new Map(
      nextPositions.map((position) => [
        position.id,
        {
          x: sourceBounds.minX + position.x,
          y: sourceBounds.minY + position.y,
        },
      ])
    );

    setItems((prev) =>
      prev.map((item) => {
        const position = arrangedById.get(item.id);
        return position ? { ...item, ...position } : item;
      })
    );
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
  const selectionPreviewIds = useMemo(
    () => getSelectionIdsFromBox(selectionBox, [...items, ...notes], viewport),
    [items, notes, selectionBox, viewport]
  );

  const activeSelection = selectionBox ? selectionPreviewIds : selection;
  const selectedImageCount = useMemo(
    () => items.filter((item) => selection.includes(item.id)).length,
    [items, selection]
  );
  const activeImageId = useMemo(() => {
    const imageSelections = selection.filter((id) => items.some((item) => item.id === id && item.type === "image"));
    return imageSelections.at(-1) || null;
  }, [items, selection]);
  const selectedImageObjects = useMemo(
    () => items.filter((item) => activeSelection.includes(item.id)),
    [activeSelection, items]
  );
  const hasImageSelection = selectedImageObjects.length > 0;
  const isDark = theme === "dark";

  const shellClass = isDark
    ? "bg-[linear-gradient(180deg,#020617_0%,#111827_100%)] text-slate-100"
    : "bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] text-neutral-900";
  const headerClass = isDark ? "border-slate-800 bg-slate-950/78" : "border-slate-200 bg-white/80";
  const badgeClass = isDark ? "bg-sky-400 text-slate-950" : "bg-slate-950 text-white";
  const secondaryButtonClass = isDark
    ? "!border-slate-700 !bg-slate-900 !text-slate-100 hover:!bg-slate-800 disabled:!border-slate-800 disabled:!bg-slate-900/70 disabled:!text-slate-500"
    : "border-slate-300 bg-white text-neutral-900 hover:bg-neutral-100";
  const primaryButtonClass = isDark
    ? "!border-sky-300 !bg-sky-400 !text-slate-950 hover:!bg-sky-300"
    : "bg-slate-950 text-white hover:bg-slate-800";
  const statusPillClass = isDark
    ? "border-slate-700 bg-slate-900 text-slate-300"
    : "border-slate-200 bg-slate-50 text-slate-600";
  const boardClass = isDark ? "bg-board dark-board" : "bg-board";
  const imageBaseClass = isDark ? "border-slate-700 bg-slate-900 shadow-[0_16px_36px_rgba(2,6,23,0.55)]" : "border-white/70 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.12)]";
  const imageSelectedClass = isDark
    ? "border-sky-300 bg-slate-900 shadow-[0_0_0_3px_rgba(125,211,252,0.7),0_18px_40px_rgba(14,165,233,0.24)]"
    : "border-sky-500 bg-white shadow-[0_0_0_3px_rgba(56,189,248,0.85),0_18px_40px_rgba(14,165,233,0.18)]";
  const imageActiveClass = isDark
    ? "border-cyan-200 bg-slate-900 shadow-[0_0_0_4px_rgba(103,232,249,0.85),0_24px_54px_rgba(34,211,238,0.32)]"
    : "border-cyan-500 bg-white shadow-[0_0_0_4px_rgba(34,211,238,0.9),0_24px_54px_rgba(14,165,233,0.24)]";
  const groupBaseClass = isDark ? "border-sky-500/70 bg-sky-500/10" : "border-sky-400 bg-sky-100/40";
  const groupSelectedClass = isDark
    ? "ring-4 ring-sky-400/40 shadow-[0_24px_50px_rgba(2,132,199,0.28)]"
    : "ring-4 ring-sky-300/70 shadow-[0_24px_50px_rgba(14,165,233,0.16)]";
  const noteBaseClass = isDark
    ? "border-amber-900/70 bg-[#3b1808] shadow-[0_14px_28px_rgba(15,23,42,0.45)]"
    : "border-amber-200 bg-yellow-50 shadow-[0_14px_28px_rgba(217,119,6,0.10)]";
  const noteSelectedClass = isDark
    ? "border-amber-300 bg-[#4a1d0a] ring-4 ring-amber-400/30 shadow-[0_22px_44px_rgba(120,53,15,0.4)]"
    : "border-amber-400 bg-amber-50 ring-4 ring-amber-200/80 shadow-[0_22px_44px_rgba(245,158,11,0.18)]";

  return (
    <div className={`h-screen w-full ${shellClass}`}>
      <div className="flex h-full flex-col">
        <div className={`border-b px-5 py-4 backdrop-blur-xl ${headerClass}`}>
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-4">
            <div className="flex items-start justify-center gap-3 text-center">
              <div className={`rounded-3xl px-4 py-2 text-sm font-semibold tracking-wide shadow-lg ${badgeClass}`}>Refolio</div>
              <div>
                <div className={`text-sm font-semibold leading-5 ${isDark ? "text-slate-100" : "text-slate-800"}`}>
                  置く、つなぐ、まとめる
                </div>
                <div className={`mt-1 text-xs leading-5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  参考画像とメモを、ひとつのボードで軽やかに整理する
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => fileInputRef.current?.click()} className={`rounded-2xl px-4 py-2.5 shadow-sm ${primaryButtonClass}`}>
              <Upload className="mr-2 h-4 w-4" />
              画像追加
            </Button>
            <Button variant="outline" onClick={addNote} className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}>
              <StickyNote className="mr-2 h-4 w-4" />
              メモ
            </Button>
            <Button
              variant="outline"
              onClick={groupSelection}
              className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}
              disabled={selection.length < 2}
            >
              <Square className="mr-2 h-4 w-4" />
              グループ化
            </Button>
            <label className="hidden">
              <span className="mr-2 whitespace-nowrap">整列</span>
              <select
                value="grid"
                className={`bg-transparent outline-none ${isDark ? "text-white" : "text-slate-900"}`}
              >
                <option value="grid">グリッド</option>
                <option value="pack">横詰め</option>
              </select>
            </label>
            <Button
              variant="outline"
              onClick={arrangeSelection}
              className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}
              disabled={selectedImageCount < 2}
            >
              自動整理
            </Button>
            <Button variant="outline" onClick={() => zoom(1.1)} className={`rounded-2xl px-3 py-2.5 ${secondaryButtonClass}`} aria-label="zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => zoom(0.9)} className={`rounded-2xl px-3 py-2.5 ${secondaryButtonClass}`} aria-label="zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={resetView} className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}>
              <RotateCcw className="mr-2 h-4 w-4" />
              リセット
            </Button>
            <Button
              variant="outline"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}
              aria-label="toggle dark mode"
            >
              {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {isDark ? "Light" : "Dark"}
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

            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className={`rounded-2xl border px-3 py-2 text-sm ${statusPillClass}`}>
                選択 <span className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{activeSelection.length}</span>
              </div>
              <div className={`rounded-2xl border px-3 py-2 text-sm ${statusPillClass}`}>
                ズーム <span className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{Math.round(viewport.scale * 100)}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1">
          <div
            ref={boardRef}
            className={`board-surface relative flex-1 overflow-hidden ${boardClass}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onPointerDown={(e) => {
              if (e.button === 1 || e.altKey) {
                startPan(e.clientX, e.clientY);
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
                const selected = activeSelection.includes(obj.id);
                const isActiveImage = obj.id === activeImageId;

                if (obj.type === "image") {
                  return (
                    <div
                      key={obj.id}
                      data-image-id={obj.id}
                      className={`absolute cursor-grab border transition duration-150 ${
                        selected ? (isActiveImage ? imageActiveClass : imageSelectedClass) : imageBaseClass
                      } ${hasImageSelection && !selected ? "opacity-80 saturate-[0.78]" : "opacity-100 saturate-100"}`}
                      style={{ left: obj.x, top: obj.y, width: obj.width, height: obj.height }}
                      onPointerDown={(e) => startItemDrag(e, obj.id)}
                    >
                      <img src={obj.src} alt={obj.name} className="h-full w-full object-cover" draggable={false} />
                      {selected && (
                        <div
                          className={`pointer-events-none absolute inset-0 ${
                            isActiveImage
                              ? isDark
                                ? "bg-cyan-300/14"
                                : "bg-cyan-300/12"
                              : isDark
                                ? "bg-sky-300/10"
                                : "bg-sky-300/8"
                          }`}
                        />
                      )}
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
                      className={`absolute rounded-[32px] border-2 border-dashed transition ${groupBaseClass} ${selected ? groupSelectedClass : ""}`}
                      style={{ left: obj.x, top: obj.y, width: obj.width, height: obj.height }}
                      onPointerDown={(e) => startItemDrag(e, obj.id)}
                    >
                      <div
                        className={`absolute left-3 top-3 rounded-full border px-3 py-1 text-xs font-semibold shadow ${
                          isDark ? "border-sky-400/30 bg-slate-950 text-sky-200" : "border-sky-200 bg-white text-sky-700"
                        }`}
                      >
                        {obj.text}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={obj.id}
                    className={`absolute rounded-[26px] border p-3 shadow-md transition ${selected ? noteSelectedClass : noteBaseClass}`}
                    style={{ left: obj.x, top: obj.y, width: obj.width, minHeight: obj.height }}
                    onPointerDown={(e) => startItemDrag(e, obj.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelection([obj.id]);
                      setEditingNoteId(obj.id);
                    }}
                  >
                    {false && selected && (
                      <div className={`mb-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold shadow ${isDark ? "bg-amber-400 text-slate-950" : "bg-amber-500 text-white"}`}>
                        選択中
                      </div>
                    )}
                    {editingNoteId === obj.id ? (
                      <textarea
                        autoFocus
                        value={obj.text === NOTE_PLACEHOLDER ? "" : obj.text}
                        placeholder={NOTE_PLACEHOLDER}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNotes((prev) => prev.map((note) => (note.id === obj.id ? { ...note, text: value } : note)));
                        }}
                        onBlur={() => setEditingNoteId((prev) => (prev === obj.id ? null : prev))}
                        className={`min-h-[96px] w-full resize-none border-none bg-transparent text-sm outline-none ${isDark ? "text-amber-50 placeholder:text-amber-200/50" : "text-slate-800"}`}
                      />
                    ) : (
                      <div className={`min-h-[96px] whitespace-pre-wrap break-words text-sm leading-6 ${isDark ? "text-amber-50" : "text-slate-800"}`}>
                        {!obj.text || obj.text === NOTE_PLACEHOLDER ? (
                          <span className={isDark ? "text-amber-200/45" : "text-slate-400"}>{NOTE_PLACEHOLDER}</span>
                        ) : (
                          obj.text
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectionBox && (
              <div
                className={`pointer-events-none absolute border-2 ${isDark ? "border-sky-300 bg-sky-400/10" : "border-blue-400 bg-blue-200/20"}`}
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
                <Card className={`max-w-xl rounded-[32px] shadow-[0_30px_80px_rgba(15,23,42,0.14)] ${isDark ? "border-slate-800 bg-slate-950/90" : "border-white/70 bg-white/90"}`}>
                  <CardContent className="p-9 text-center">
                    <div className={`mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-[28px] shadow-inner ${isDark ? "bg-slate-900" : "bg-sky-50"}`}>
                      <ImageIcon className={`h-8 w-8 ${isDark ? "text-sky-300" : "text-sky-500"}`} />
                    </div>
                    <h2 className={`mb-2 text-2xl font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                      画像を置いて、あとから整理する
                    </h2>
                    <p className={`hidden mb-6 text-sm leading-6 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      画像をドラッグ&ドロップ、または「画像追加」で読み込めます。ホイールでズーム、中クリックまたは Alt ドラッグでボード移動、四隅のハンドルでリサイズできます。
                    </p>
                    <p className={`mb-6 text-sm leading-6 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      画像を置いて、ドラッグで動かし、必要ならメモを添えられます。
                    </p>
                    <div className="flex justify-center gap-2">
                      <Button onClick={() => fileInputRef.current?.click()} className={`rounded-2xl px-4 py-2.5 ${primaryButtonClass}`}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        画像を選ぶ
                      </Button>
                      <Button variant="outline" onClick={addNote} className={`rounded-2xl px-4 py-2.5 ${secondaryButtonClass}`}>
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
