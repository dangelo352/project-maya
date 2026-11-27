"""Idempotently install the bounded user-level Qwen model_router.py unload route."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
handler_anchor = "async def handle_status(request: web.Request) -> web.Response:\n"
route_anchor = "    app.router.add_get('/status', handle_status)\n"
handler_start = "async def handle_unload(request: web.Request) -> web.Response:\n"
handler = '''async def handle_unload(request: web.Request) -> web.Response:
    """Stop the current model under manager_lock; safe to repeat."""
    global active_id, loading_id, last_error
    acquired = False
    try:
        await asyncio.wait_for(manager_lock.acquire(), timeout=STOP_TIMEOUT_S + 30)
        acquired = True
        was_loaded = engine_info() is not None
        await stop_engine()
        active_id = None
        loading_id = None
        last_error = None
        write_state()
        status = 'unloaded' if was_loaded else 'already_idle'
        log.info('unload completed status=%s', status)
        return web.json_response({'ok': True, 'status': status, 'active_model': None})
    except asyncio.TimeoutError:
        return web.json_response(
            {'ok': False, 'status': 'busy', 'error': {'message': 'model manager remained busy; retry unload'}}, status=409,
        )
    except Exception as exc:
        last_error = f'{type(exc).__name__}: {exc}'
        write_state()
        log.exception('unload failed')
        return web.json_response(
            {'ok': False, 'status': 'error', 'error': {'message': last_error}}, status=503,
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
route_line = "    app.router.add_post('/unload', handle_unload)\n"
if route_line not in source:
    source = source.replace(route_anchor, route_anchor + route_line, 1)
path.write_text(source, encoding="utf-8")
