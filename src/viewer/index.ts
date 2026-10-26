// Browser bundle for viewer.html (built as dist/omm-viewer.global.js, global `OmmViewer`).
// Shares parsers with the CLI so the viewer and `omm validate` read diagrams the same way.
export { parseErDiagram, detectDiagramType, cardinalityText } from '../lib/er.js';
