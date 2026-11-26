# Maya Inkling endpoint smoke check

`smoke.py` is a bounded, standard-library-only smoke client for a future native
Windows Maya Inkling endpoint that implements the OpenAI chat completions API.
It checks model discovery, a short normal chat, SSE streaming, a two-turn tool
call round trip, and optional image input. The image check generates a tiny PNG
fixture locally; it does not download or require an image package.

## Run

Start the endpoint separately, then from the repository root run:

```powershell
py tests/ik2_smoke/smoke.py
```

The default URL is `http://127.0.0.1:8080`. Supply a different loopback port as
the optional positional argument:

```powershell
py tests/ik2_smoke/smoke.py 8090
```

Or provide a full base URL and model id when the server needs them:

```powershell
py tests/ik2_smoke/smoke.py --url http://127.0.0.1:8080 --model inkling2
```

Useful bounds can be adjusted with `--timeout` (default 30 seconds),
`--max-tokens` (96), `--max-response-bytes` (1,000,000), and
`--max-sse-events` (256). Each check prints its HTTP status and elapsed time;
failures include a concise response excerpt. Unsupported image input is
reported as a skip for common unsupported/media-validation statuses. The
generated `fixtures/ik2_smoke_fixture.png` is a disposable local test artifact.

The tool round trip exposes only a fixed `get_smoke_fixture` function and
executes it locally. The script does not execute model-provided code, shell
commands, or arbitrary tools. All requests target the configured endpoint;
the default binds the client to loopback. No GPU or model is needed to create
the fixture, but running the script does make inference requests and should be
done only when the intended local endpoint is available.
