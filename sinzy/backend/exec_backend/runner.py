import json
import runpy
import sys
import os
import traceback

TRACE_PREFIX = "__TRACE__"
MAX_REPR = 200
MAX_LOCALS = 50

def safe_repr(x):
    try:
        s = repr(x)
    except Exception:
        s = "<unreprable>"
    if len(s) > MAX_REPR:
        s = s[:MAX_REPR] + "…"
    return s

def emit(obj):
    sys.stdout.write(TRACE_PREFIX + json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def trace_factory(target_abspath: str):
    target_abspath = os.path.abspath(target_abspath)

    def tracer(frame, event, arg):
        code = frame.f_code
        file = os.path.abspath(code.co_filename)

        if file != target_abspath:
            return tracer

        fn_name = code.co_name
        line_no = frame.f_lineno

        locals_snapshot = {}
        try:
            for i, (k, v) in enumerate(frame.f_locals.items()):
                if i >= MAX_LOCALS:
                    break
                locals_snapshot[k] = sage_repr(v)
        except Exception:
            locals_snapshot = {"<locals_error>": "failed to snapshot locals"}

        emit({
            "event": event,
            "file": file,
            "fn": fn_name,
            "line": line_no,
            "locals": locals_snapshot,
            })

        return tracer
    return tracer

def main():
    if len(sys.argv) != 2:
        sys.stderr.write("Usage: runner.py <script.py>\n")
        sys.exit(2)

    script = sys.argv[1]
    script_abspath = os.path.abspath(script)

    sys.path.insert(0, os.path.dirname(script_abspath))

    sys.settrace(trace_factory(script_abspath))

    try:
        runpy.run_path(script_abspath, run_name="__main__")
    except SystemExit as e:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
    finally:
        sys.settrace(None)



if __name__ == "__main__":
    main()
