import json
import base64

with open('sponsors.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

encrypted = base64.b64encode(json.dumps(data).encode()).decode()
encrypted = ''.join(reversed(encrypted))

js_content = f'''// 加密后的数据
export const encryptedSponsors = "{encrypted}";
'''

with open('encrypted_sponsors.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print("encrypted_sponsors.js has been generated successfully!") 