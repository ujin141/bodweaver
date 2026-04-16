const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// 메모리 DB (임시 데이터베이스 역할)
let rooms = [
  { id:'1', game:'🎲 뱅!', status:'모집중', statusCls:'open', title:'강남에서 뱅! 같이 할 사람', place:'강남역 보드카페', time:'오늘 오후 7시', members:2, max:6, level:'모두 환영', desc:'초보 환영' },
  { id:'2', game:'🃏 카탄', status:'모집중', statusCls:'open', title:'카탄 초보 환영 🤝', place:'홍대 게임바', time:'오늘 오후 6시', members:3, max:4, level:'초보 환영', desc:'같이 규칙봐요' },
  { id:'3', game:'🎯 루미큐브', status:'오늘 저녁', statusCls:'soon', title:'루미큐브 고수 구합니다', place:'신촌 카페', time:'저녁 8시', members:1, max:4, level:'중급 이상', desc:'매너 게임' }
];
let chatMessages = [];

// REST API
// 모임 리스트 가져오기
app.get('/api/rooms', (req, res) => {
  res.json(rooms);
});

// 모임 참석 신청
app.post('/api/rooms/:id/join', (req, res) => {
  const room = rooms.find(r => r.id === req.params.id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  
  if (room.members < room.max) {
    room.members++;
    res.json({ success: true, room });
  } else {
    res.status(400).json({ error: '인원이 가득 찼습니다.' });
  }
});

// 소켓 통신 (실시간 채팅)
io.on('connection', (socket) => {
  console.log('[+] 유저 접속 성공:', socket.id);
  
  // 처음 접속 시 과거 채팅 내역 전송
  socket.emit('init_messages', chatMessages);
  
  // 유저가 보낸 메시지 수신
  socket.on('send_message', (msgData) => {
    const newMsg = { ...msgData, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
    chatMessages.push(newMsg);
    // 접속한 모든 사람에게 실시간 뿌리기 (Broadcast)
    io.emit('new_message', newMsg); 
  });

  socket.on('disconnect', () => {
    console.log('[-] 유저 접속 종료:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 보드위버 백엔드 서버 실행 완료! (PORT:${PORT})`);
  console.log(`   http://localhost:${PORT}/api/rooms`);
  console.log(`=========================================`);
});
