import ast
import json
import re
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request

from COMMON.Cast import HexArr2Str

panel_bp = Blueprint('panel_api', __name__)

IMAGE_FOLDERS = {
    'white': Path('static/assets/white'),
    'blue': Path('static/assets/blue'),
    'red': Path('static/assets/red'),
}

BLOCK_PATTERN = re.compile(r'on\s+([a-zA-Z_][\w]*)\s*(?:([^\{]*))?\{([^}]*)\}', re.IGNORECASE | re.DOTALL)


def _panel_data_path():
  root = Path(current_app.root_path)
  data_dir = root / 'data'
  data_dir.mkdir(parents=True, exist_ok=True)
  return data_dir / 'panel_layout.json'


def _get_state():
  return current_app.config.get('CANX_STATE')


def _normalize_literal(text):
  if not isinstance(text, str):
    return text
  sanitized = re.sub(r'([{,]\s*)([A-Za-z_][\w]*)\s*:', r"\1'\2':", text)
  sanitized = re.sub(r'\btrue\b', 'True', sanitized, flags=re.IGNORECASE)
  sanitized = re.sub(r'\bfalse\b', 'False', sanitized, flags=re.IGNORECASE)
  sanitized = re.sub(r'\bnull\b', 'None', sanitized, flags=re.IGNORECASE)
  return sanitized


def _split_commands(body):
  commands = []
  current = []
  depth = 0
  in_string = False
  string_char = ''
  prev_char = ''
  for char in body:
    if in_string:
      current.append(char)
      if char == string_char and prev_char != '\\':
        in_string = False
      prev_char = char
      continue
    if char in ('"', "'"):
      in_string = True
      string_char = char
      current.append(char)
      prev_char = char
      continue
    if char == '{':
      depth += 1
    elif char == '}':
      depth = max(0, depth - 1)
    if char == ';' and depth == 0:
      command = ''.join(current).strip()
      if command:
        commands.append(command)
      current = []
      prev_char = char
      continue
    current.append(char)
    prev_char = char
  tail = ''.join(current).strip()
  if tail:
    commands.append(tail)
  return commands


def _condition_matches(condition, state):
  if not condition:
    return True
  if not isinstance(state, dict):
    return False
  match = re.match(r'([A-Za-z_][\w]*)\s*(==|!=|>=|<=|>|<)\s*(.+)', condition)
  if not match:
    return False
  signal_name, operator, threshold = match.groups()
  incoming = state.get('signal')
  if incoming and signal_name and incoming.strip().lower() != signal_name.strip().lower():
    return False
  try:
    rhs = ast.literal_eval(_normalize_literal(threshold.strip()))
  except Exception:
    rhs = threshold.strip()
  lhs = state.get('value', state.get('raw'))
  try:
    lhs_val = float(lhs)
    rhs_val = float(rhs)
  except Exception:
    lhs_val = lhs
    rhs_val = rhs
  try:
    if operator == '==':
      return lhs_val == rhs_val
    if operator == '!=':
      return lhs_val != rhs_val
    if operator == '>':
      return lhs_val > rhs_val
    if operator == '<':
      return lhs_val < rhs_val
    if operator == '>=':
      return lhs_val >= rhs_val
    if operator == '<=':
      return lhs_val <= rhs_val
  except Exception:
    return False
  return False


def _parse_commands(script, event_name, state):
  actions = []
  if not script or not event_name:
    return actions
  for match in BLOCK_PATTERN.finditer(script):
    event = (match.group(1) or '').strip().lower()
    condition = (match.group(2) or '').strip()
    if event != event_name.lower():
      continue
    if event == 'rx' and not _condition_matches(condition, state or {}):
      continue
    body = match.group(3) or ''
    commands = _split_commands(body)
    for command in commands:
      parsed = _command_to_action(command, state or {})
      if parsed:
        actions.append(parsed)
  return actions


def _command_to_action(command, state=None):
  if not command:
    return None
  trimmed = command.strip()
  lowered = trimmed.lower()
  if lowered.startswith('send'):
    start = trimmed.find('(')
    end = trimmed.rfind(')')
    if start == -1 or end == -1 or end <= start:
      return None
    args = trimmed[start + 1 : end]
    normalized = _normalize_literal(args)
    if state:
      if 'state.value' in normalized:
        normalized = normalized.replace('state.value', str(state.get('value', state.get('raw', 0))))
      if 'state.raw' in normalized:
        normalized = normalized.replace('state.raw', str(state.get('raw', state.get('value', 0))))
    try:
      parsed = ast.literal_eval(f'({normalized})')
    except Exception:
      return None
    if not isinstance(parsed, tuple) or len(parsed) < 2:
      return None
    message, signals = parsed[0], parsed[1]
    if not isinstance(message, str):
      return None
    if isinstance(signals, dict):
      return {'type': 'send', 'message': message, 'signals': signals}
    if isinstance(signals, (int, float)):
      return {'type': 'send', 'message': message, 'value': signals}
    if len(parsed) >= 3 and isinstance(signals, str):
      return {'type': 'send', 'message': message, 'signal': signals, 'value': parsed[2]}
    return None
  lamp_match = re.match(r"lamp\s*\((['\"])(.+?)\1\)\s*\.\s*(on|off)\s*\(\s*\)", trimmed, re.IGNORECASE)
  if lamp_match:
    target = lamp_match.group(2)
    state = lamp_match.group(3).lower()
    return {'type': 'lamp', 'target': target, 'state': 'on' if state == 'on' else 'off'}
  return None


@panel_bp.route('/save', methods=['POST'])
def save_panel_layout():
  payload = request.get_json(force=True, silent=True) or {}
  layout = {
    'version': int(payload.get('version', 1)),
    'grid': payload.get('grid') or {},
    'widgets': payload.get('widgets') or [],
  }
  try:
    path = _panel_data_path()
    path.write_text(json.dumps(layout, indent=2))
    return jsonify({'ok': True})
  except Exception as exc:
    return jsonify({'ok': False, 'error': str(exc)}), 500


@panel_bp.route('/load', methods=['GET'])
def load_panel_layout():
  path = _panel_data_path()
  if not path.exists():
    return jsonify({'ok': True, 'layout': None})
  try:
    data = json.loads(path.read_text())
  except Exception as exc:
    return jsonify({'ok': False, 'error': str(exc)}), 500
  return jsonify({'ok': True, 'layout': data})


@panel_bp.route('/send-signal', methods=['POST'])
def panel_send_signal():
  state = _get_state()
  if not state or not state.canif or not state.canif.dbc:
    return jsonify({'ok': False, 'error': 'CAN not initialized'}), 400
  payload = request.get_json(force=True, silent=True) or {}
  message = payload.get('message')
  if not message:
    return jsonify({'ok': False, 'error': 'Missing message name'}), 400
  signals = payload.get('signals')
  signal_name = payload.get('signal')
  value = payload.get('value')
  updates = {}
  if isinstance(signals, dict):
    updates = {k: v for k, v in signals.items() if k}
  elif signal_name:
    updates = {signal_name: value}
  if not updates:
    return jsonify({'ok': False, 'error': 'No signal data provided'}), 400
  try:
    state.canif.update_periodic(message, updates)
    message_obj = state.canif.get_msg_att(message)
    frame_id = getattr(message_obj, 'frame_id', None)
    if frame_id is None:
      raise ValueError('Message missing frame id')
    payload_bytes = state.canif.dbc.get_payload(message)
    data_hex = HexArr2Str(payload_bytes)
    can_id = f"{int(frame_id):X}"
    state.canif.write(can_id, data_hex)
    return jsonify({'ok': True})
  except Exception as exc:
    return jsonify({'ok': False, 'error': str(exc)}), 400


@panel_bp.route('/script-eval', methods=['POST'])
def panel_script_eval():
  payload = request.get_json(force=True, silent=True) or {}
  script = payload.get('script')
  event = payload.get('event')
  state = payload.get('state') or {}
  if not script or not event:
    return jsonify({'ok': True, 'actions': []})
  actions = _parse_commands(script, str(event), state)
  return jsonify({'ok': True, 'actions': actions[:20]})


@panel_bp.route('/list-images', methods=['GET'])
def panel_list_images():
  result = {color: [] for color in IMAGE_FOLDERS.keys()}
  root = Path(current_app.root_path)
  for color, rel_path in IMAGE_FOLDERS.items():
    try:
      target_dir = root / rel_path
      if not target_dir.exists() or not target_dir.is_dir():
        continue
      entries = [
        entry.name
        for entry in target_dir.iterdir()
        if entry.is_file() and entry.suffix.lower() in {'.png', '.jpg', '.jpeg', '.svg'}
      ]
      result[color] = sorted(entries)
    except Exception:
      result[color] = []
  return jsonify(result)
