import type { MindmapLayout, MindmapNode } from '../src/app/core/mindmap';

const MAP_NODE_CSS = `
.map-stage { width: 900px; height: 640px; overflow: auto; border: 1px solid #333; position: relative; }
.map-canvas { position: relative; transform-origin: 0 0; background: #141210; }
.map-node {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 2px solid #888;
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  background: #f4efe6;
  color: #1c1915;
}
.map-node.circle { border-radius: 50%; }
.map-node.dragging { cursor: grabbing; opacity: 0.92; }
`;

export function buildMindmapHarnessHtml(layout: MindmapLayout, zoom = 0.12): string {
  const nodesHtml = layout.nodes.map((node) => renderNode(node)).join('\n');
  const data = JSON.stringify(layout.nodes.filter((node) => node.kind === 'task'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mindmap drag harness</title>
  <style>${MAP_NODE_CSS}</style>
</head>
<body>
  <motion-cue id="moved" hidden data-testid="drag-result">moved</motion-cue>
  <div class="map-stage" id="stage">
    <div class="map-canvas" id="canvas" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom});">
      ${nodesHtml}
    </div>
  </div>
  <script>
    const zoom = ${zoom};
    const nodes = ${data};
    const canvas = document.getElementById('canvas');
    const moved = document.getElementById('moved');

    function worldFromPointer(ev) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left) / zoom,
        y: (ev.clientY - rect.top) / zoom,
      };
    }

  function onNodePointerDown(el, ev) {
    ev.stopPropagation();
    const id = el.dataset.nodeId;
    const startWorld = worldFromPointer(ev);
    const startX = ev.clientX;
    const startY = ev.clientY;
    let originX = Number(el.dataset.x);
    let originY = Number(el.dataset.y);
    let dragged = false;
    el.classList.add('dragging');
    const move = (moveEv) => {
      const dx = (moveEv.clientX - startX) / zoom;
      const dy = (moveEv.clientY - startY) / zoom;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      const x = originX + dx;
      const y = originY + dy;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.dataset.x = String(Math.round(x));
      el.dataset.y = String(Math.round(y));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (dragged) {
        moved.removeAttribute('hidden');
        moved.dataset.nodeId = id;
        moved.dataset.x = el.dataset.x;
        moved.dataset.y = el.dataset.y;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  canvas.querySelectorAll('.map-node').forEach((el) => {
    el.addEventListener('pointerdown', (ev) => onNodePointerDown(el, ev));
  });
  </script>
</body>
</html>`;
}

function renderNode(node: MindmapNode): string {
  const classes = ['map-node'];
  if (node.shape === 'project' || node.shape === 'subproject') classes.push('circle');
  return `<div class="${classes.join(' ')}"
    data-node-id="${escapeAttr(node.id)}"
    data-x="${Math.round(node.x)}"
    data-y="${Math.round(node.y)}"
    style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px"
  ><span>${escapeHtml(node.label)}</span></div>`;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}