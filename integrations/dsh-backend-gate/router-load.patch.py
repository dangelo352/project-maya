"""Idempotently install the bounded Qwen model_router.py load endpoint."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
handler_anchor = "async def handle_unload(request: web.Request) -> web.Response:\n"
route_anchor = "    app.router.add_get('/status', handle_status)\n"
handler_start = "async def handle_load(request: web.Request) -> web.Response:\n"
handler = '''async def handle_load(request: web.Request) -> web.Response:
    """Load one configured model on explicit DSH selection and report completion."""
    try:
        payload = await request.json() if request.can_read_body else {}
    except Exception as exc:
        raise web.HTTPBadRequest(text='expected a JSON model selection') from exc
    requested = payload.get('model') if isinstance(payload, dict) else None
    model_id = resolve_model_id(requested or SERVED_ID)
    acquired = False
    try:
        await asyncio.wait_for(manager_lock.acquire(), timeout=STOP_TIMEOUT_S + 30)
        acquired = True
        await ensure_model(model_id)
        info = engine_info()
        return web.json_response({
            'ok': True, 'status': 'ready', 'active_model': active_id,
            'loading_model': loading_id, 'engine_pid': info[0] if info else None,
        })
    except asyncio.TimeoutError:
        return web.json_response(
            {'ok': False, 'status': 'busy', 'error': {'message': 'model manager remained busy; retry load'}}, status=409,
        )
    finally:
        if acquired:
            manager_lock.release()


'''
if handler_anchor not in source or route_anchor not in source:
    raise SystemExit("expected router anchors not found; no change made")
if handler_start in source:
    start = source.index(handler_start)
    end = source.index(handler_anchor, start)
    source = source[:start] + handler + source[end:]
else:
    source = source.replace(handler_anchor, handler + handler_anchor, 1)
route_line = "    app.router.add_post('/load', handle_load)\n"
if route_line not in source:
    source = source.replace(route_anchor, route_anchor + route_line, 1)
path.write_text(source, encoding="utf-8")
