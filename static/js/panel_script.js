export class PanelScriptEngine {
  constructor({ evaluateScript, sendSignal, applyWidgetAction } = {}) {
    this.evaluateScript = evaluateScript;
    this.sendSignal = sendSignal;
    this.applyWidgetAction = applyWidgetAction;
  }

  async trigger(widget, event, state = {}) {
    if (!widget || !widget.script || !widget.script.trim()) return;
    if (typeof this.evaluateScript !== 'function') return;
    try {
      const response = await this.evaluateScript({
        script: widget.script,
        event,
        state: {
          widgetId: widget.id,
          message: widget.mapping?.message || null,
          signal: widget.mapping?.signal || null,
          ...state,
        },
      });
      const actions = Array.isArray(response?.actions) ? response.actions : [];
      for (const action of actions) {
        await this._executeAction(action, widget);
      }
    } catch (err) {
      console.error('Panel script evaluation failed', err);
    }
  }

  async _executeAction(action) {
    if (!action || typeof action !== 'object') return;
    switch (action.type) {
      case 'send':
        if (this.sendSignal) {
          await this.sendSignal({
            message: action.message || action.payload?.message,
            signal: action.signal || action.payload?.signal,
            value: action.value ?? action.payload?.value,
            signals: action.signals || action.payload?.signals,
          });
        }
        break;
      case 'lamp':
      case 'widget_state':
        if (typeof this.applyWidgetAction === 'function') {
          this.applyWidgetAction(action);
        }
        break;
      default:
        break;
    }
  }
}
