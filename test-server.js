const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3001;
const distPath = path.join(__dirname, 'dist');

const server = http.createServer((req, res) => {
  let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url);
  
  // Security check
  if (!filePath.startsWith(distPath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      // Set content type based on file extension
      const ext = path.extname(filePath);
      let contentType = 'text/html';
      switch (ext) {
        case '.js':
          contentType = 'application/javascript';
          break;
        case '.css':
          contentType = 'text/css';
          break;
        case '.json':
          contentType = 'application/json';
          break;
      }
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log('Try accessing http://localhost:3001 in your browser');
  
  // Auto-close after 30 seconds
  setTimeout(() => {
    console.log('Closing test server...');
    server.close();
  }, 30000);
});