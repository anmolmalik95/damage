let _pending = null;

export function setPendingParse(state) { _pending = state; }
export function takePendingParse() { const p = _pending; _pending = null; return p; }
