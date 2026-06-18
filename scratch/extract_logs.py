import json
import re

log_path = r'C:\Users\gleidson.rampinelli\.gemini\antigravity\brain\168b37ae-3df2-410c-8e0c-18222cdfde65\.system_generated\logs\overview.txt'

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if 'tool_calls' in data:
                for call in data['tool_calls']:
                    if call['name'] == 'write_to_file':
                        args = call['args']
                        target = args.get('TargetFile', '').replace('"', '').replace('\\\\', '\\')
                        content = args.get('CodeContent', '')
                        if content.startswith('"') and content.endswith('"'):
                            content = content[1:-1]
                        # Unescape
                        content = content.encode().decode('unicode_escape')
                        
                        filename = target.split('\\')[-1]
                        print(f"Extracted: {filename}")
                        with open(filename, 'w', encoding='utf-8') as out:
                            out.write(content)
                    
                    if call['name'] == 'replace_file_content' or call['name'] == 'multi_replace_file_content':
                        # These are harder because they are diffs, but maybe I can see the final version?
                        # Actually, better to just see the last write_to_file for new files.
                        pass
        except Exception as e:
            # print(f"Error: {e}")
            pass
