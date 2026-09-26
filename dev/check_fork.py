"""Check the built fork. Run python3 build.py first; no deployment or model downloads."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def run(args, expected=None):
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print('$', ' '.join(args), flush=True)
    print(result.stdout, end='', flush=True)
    if result.returncode or (expected is not None and result.stdout.strip().splitlines()[-1:] != [expected]):
        raise SystemExit(result.returncode or 1)

for script in [
    'test_locked_line_effects.mjs', 'png_zip_limits_test.js', 'timing_test.js',
    'line_times_test.js', 'chunk_text_test.js', 'cut_text_test.js', 'whisper_test.js',
    'test_visible_tech_previews.mjs', 'test_project_load_history.mjs',
    'test_cancel_audio_on_reset.mjs', 'line_times_ui_test.mjs',
    'test_whisper_lifecycle.mjs', 'test_editions.mjs',
]:
    run(['node', 'dev/' + script])
for folder in ['', 'en/', 'id/', 'ko/', 'vi/', 'zh-hans/', 'zh-hant/']:
    run([sys.executable, 'tools/check_page_js.py', folder + 'index.html'], 'JS OK')
for code in ['zh-Hant', 'zh-Hans', 'ko', 'id', 'vi']:
    run([sys.executable, 'tools/check_i18n.py', code], 'OK')
print('All fork checks passed.')
