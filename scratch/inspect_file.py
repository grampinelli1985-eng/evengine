import os

path = r'd:\ProjetosAPP\BetGuru\BetGuru\src\components\AnalysisView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines[120:360], 121):
    if '<h3' in line or '<h4' in line or '<h5' in line:
        print(f"{i}: {repr(line)}")
