import http.server, socketserver, os, sys
os.chdir(sys.argv[2] if len(sys.argv)>2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PORT=int(sys.argv[1]) if len(sys.argv)>1 else 8946
class T(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads=True
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
T(('127.0.0.1',PORT),H).serve_forever()
