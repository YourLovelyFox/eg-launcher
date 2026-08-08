import http.server, os, re, json

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
os.makedirs(DIR, exist_ok=True)

HTML = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Upload</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui;background:#020208;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
form{background:#12101e;padding:32px 40px;border-radius:18px;border:1px solid rgba(179,136,255,0.3);box-shadow:0 0 60px rgba(179,136,255,0.1);min-width:420px}
h2{color:#b388ff;margin:0 0 4px;font-size:20px}
.sub{color:#888;font-size:13px;margin-bottom:20px}
input[type=file]{display:block;margin:0 0 16px;padding:10px 12px;border-radius:10px;border:1px solid #333;background:#0a0818;color:#ccc;width:100%;cursor:pointer;font-size:13px}
button{background:linear-gradient(135deg,#b388ff,#18e5ff);color:#000;border:none;padding:12px 24px;border-radius:10px;font-weight:700;cursor:pointer;width:100%;font-size:14px;transition:opacity .2s}
button:disabled{opacity:.4;cursor:not-allowed}
.bar-wrap{height:8px;background:rgba(255,255,255,.06);border-radius:99px;margin:16px 0;overflow:hidden;display:none}
.bar-fill{height:100%;background:linear-gradient(90deg,#b388ff,#18e5ff);border-radius:99px;width:0%;transition:width .2s;box-shadow:0 0 12px rgba(179,136,255,.4)}
.stats{display:flex;justify-content:space-between;font-size:12px;color:#888;margin-top:-8px;margin-bottom:12px;display:none}
.msg{margin-top:12px;font-size:13px;word-break:break-all}
.msg.success{color:#18e5ff}
.msg.error{color:#ff4060}
.speed{color:#b388ff}
</style></head><body>
<form id="f"><h2>Upload synthwave-bg.mp4</h2>
<div class="sub">503 MB — drops into public/ folder</div>
<input type="file" id="file" accept="video/mp4,.mp4">
<div class="bar-wrap" id="wrap"><div class="bar-fill" id="bar"></div></div>
<div class="stats" id="stats"><span id="done">0 MB</span> / <span id="total">0 MB</span> · <span class="speed" id="speed">—</span></div>
<button type="submit" id="btn">Upload</button>
<div class="msg" id="msg"></div></form>
<script>
const f=document.getElementById('f'),file=document.getElementById('file'),
  bar=document.getElementById('bar'),wrap=document.getElementById('wrap'),
  stats=document.getElementById('stats'),done=document.getElementById('done'),
  total=document.getElementById('total'),speed=document.getElementById('speed'),
  btn=document.getElementById('btn'),msg=document.getElementById('msg');
let start=0;
f.onsubmit=e=>{e.preventDefault();
  const fd=new FormData(); fd.append('video',file.files[0]);
  const x=new XMLHttpRequest();
  x.upload.onprogress=ev=>{
    if(!start) start=Date.now();
    const pct=Math.round(ev.loaded/ev.total*100);
    bar.style.width=pct+'%';
    const mb=v=>Math.round(v/1048576);
    done.textContent=mb(ev.loaded)+' MB';
    total.textContent=mb(ev.total)+' MB';
    const elapsed=(Date.now()-start)/1000;
    if(elapsed>0.5) speed.textContent=(mb(ev.loaded)/elapsed).toFixed(1)+' MB/s';
  };
  x.onload=()=>{
    if(x.status===200) msg.className='msg success',msg.textContent='Done! Restart npm run dev';
    else msg.className='msg error',msg.textContent='Error: '+x.status;
    btn.disabled=false;
  };
  x.onerror=()=>{msg.className='msg error';msg.textContent='Network error';btn.disabled=false};
  wrap.style.display='block';stats.style.display='flex';btn.disabled=true;msg.textContent='';msg.className='msg';start=0;
  x.open('POST','/');x.setRequestHeader('X-Filename',file.files[0].name);x.send(file.files[0]);
};
</script></body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self._page()
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        path = os.path.join(DIR, 'synthwave-bg.mp4')
        ok = False
        try:
            with open(path, 'wb') as f:
                remain = length
                while remain > 0:
                    chunk = self.rfile.read(min(remain, 65536))
                    if not chunk: break
                    f.write(chunk)
                    remain -= len(chunk)
            ok = True
        except Exception as e:
            print(f'Upload error: {e}')
        self.send_response(200 if ok else 500)
        self.send_header('Content-Type', 'text/plain'); self.end_headers()
        self.wfile.write(b'OK' if ok else b'FAIL')
    def _page(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html'); self.end_headers()
        self.wfile.write(HTML.encode())
    def log_message(self, f, *a): pass

print('Upload server: http://57.129.0.64:8080')
http.server.HTTPServer(('0.0.0.0',8080), H).serve_forever()
