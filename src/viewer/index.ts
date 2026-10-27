// Browser bundle for viewer.html (built as dist/omm-viewer.global.js, global `OmmViewer`).
// Shares parsers with the CLI so the viewer and `omm validate` read diagrams the same way.
export { detectDiagramType } from '../lib/diagram.js';
export { parseErDiagram, cardinalityText } from '../lib/er.js';
export { parseSequenceDiagram, messageStyle } from '../lib/sequence.js';
export { parseStateDiagram, stateDisplayId } from '../lib/state.js';
export { parseFlowchart } from '../lib/flowchart.js';
export { nodeColors, flowNodeRole, isProcessFlowchart } from '../lib/palette.js';
