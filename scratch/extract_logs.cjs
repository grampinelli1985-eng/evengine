const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\gleidson.rampinelli\\.gemini\\antigravity\\brain\\168b37ae-3df2-410c-8e0c-18222cdfde65\\.system_generated\\logs\\overview.txt';

const lines = fs.readFileSync(logPath, 'utf8').split('\n');

lines.forEach(line => {
    if (!line.trim()) return;
    try {
        const data = JSON.parse(line);
        if (data.tool_calls) {
            data.tool_calls.forEach(call => {
                if (call.name === 'write_to_file') {
                    let { TargetFile, CodeContent } = call.args;
                    TargetFile = JSON.parse(TargetFile);
                    CodeContent = JSON.parse(CodeContent);
                    
                    const filename = path.basename(TargetFile);
                    console.log(`Extracted: ${filename}`);
                    fs.writeFileSync(filename, CodeContent);
                }
            });
        }
    } catch (e) {
        // console.error(e);
    }
});
