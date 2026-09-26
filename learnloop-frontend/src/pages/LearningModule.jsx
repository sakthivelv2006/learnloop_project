import React, { useState, useRef, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { FaPaperPlane, FaVideo, FaFile, FaArrowLeft } from "react-icons/fa";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";
import { api } from "../api";

export default function LearningModule() {
  const navigate = useNavigate();
  const { skill } = useParams();
  const location = useLocation();

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [stompClient, setStompClient] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const chatRef = useRef(null);
  const fileInputRef = useRef(null);

  // Get current user
  const currentUser = localStorage.getItem("name") || "UnknownUser";

  // Get peer user with multiple fallbacks
  const getPeerUser = () => {
    // Try location state first
    if (location.state?.peer) {
      return location.state.peer;
    }
    // Try localStorage
    const storedPeer = localStorage.getItem("peerName");
    if (storedPeer) {
      return storedPeer;
    }
    return null;
  };

  const peerUser = getPeerUser();
  const currentSkill = skill || localStorage.getItem("currentSkill") || "General Skill";

  // Generate room ID


 const generateRoomId = () => {
  if (!currentUser || !peerUser || !currentSkill) return null;

  const normalize = (str) =>
    str.trim().toLowerCase().replace(/\s+/g, "_");

  const users = [normalize(currentUser), normalize(peerUser)].sort();
  const skill = normalize(currentSkill);

  return `${users[0]}_${users[1]}_${skill}`;
};



  const roomId = generateRoomId();

  // Check if we have all required data
  // Add this debug useEffect
  useEffect(() => {
    console.log("🔍 LearningModule Check:");
    console.log("   - currentUser:", currentUser);
    console.log("   - peerUser:", peerUser);
    console.log("   - skill:", skill);
    console.log("   - location.state:", location.state);
    console.log("   - localStorage peerName:", localStorage.getItem("peerName"));
    console.log("   - localStorage currentSkill:", localStorage.getItem("currentSkill"));

    // If peerUser is undefined but exists in localStorage, use it
    if (!peerUser && localStorage.getItem("peerName")) {
      console.log("✅ Found peer in localStorage, updating...");
      setPeerUser(localStorage.getItem("peerName"));
    }

    setLoading(false);
  }, []);

  // Load messages
  useEffect(() => {
    if (!roomId) return;

    const loadMessages = async () => {
      try {
        console.log("Loading messages for room:", roomId);
        const response = await api.get(`/chat/${roomId}`);
        console.log("Messages loaded:", response.data);
        setMessages(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error("Error loading messages:", err);
        setMessages([]);
      }
    };

    loadMessages();
  }, [roomId]);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // WebSocket connection
  useEffect(() => {
    if (!roomId) {
      console.log("No roomId, waiting...");
      return;
    }

    console.log("Initializing WebSocket for room:", roomId);

    // Create SockJS connection
    const socket = new SockJS("http://localhost:8080/chat");
    const client = new Client({
      webSocketFactory: () => socket,
      debug: (str) => {
        console.log("STOMP:", str);
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    client.onConnect = () => {
      console.log("✅ WebSocket Connected successfully!");
      setConnected(true);
      setError("");

      // Subscribe to the room
      client.subscribe(`/topic/chat/${roomId}`, (message) => {
        try {
          const receivedMessage = JSON.parse(message.body);
          console.log("📩 Received message:", receivedMessage);

          setMessages(prev => {
            // Check for duplicates
            const exists = prev.some(m =>
              m.content === receivedMessage.content &&
              m.sender === receivedMessage.sender &&
              m.timestamp === receivedMessage.timestamp
            );

            if (exists) {
              console.log("Duplicate message ignored");
              return prev;
            }

            return [...prev, receivedMessage];
          });
        } catch (e) {
          console.error("Error parsing message:", e);
        }
      });

      console.log(`✅ Subscribed to /topic/chat/${roomId}`);
    };

    client.onStompError = (frame) => {
      console.error("STOMP error:", frame);
      setConnected(false);
      setError("Connection error. Trying to reconnect...");
    };

    client.onDisconnect = () => {
      console.log("WebSocket disconnected");
      setConnected(false);
    };

    client.activate();
    setStompClient(client);

    // Cleanup
    return () => {
      console.log("Cleaning up WebSocket connection");
      if (client.active) {
        client.deactivate();
      }
    };
  }, [roomId]);

  const sendMessage = () => {
    if (!text.trim()) {
      alert("Please enter a message");
      return;
    }

    if (!stompClient || !stompClient.connected) {
      console.log("STOMP client not connected");
      alert("Not connected to chat server. Please wait...");
      return;
    }

    if (!roomId) {
      alert("Chat room not available");
      return;
    }

    const chatMessage = {
      sender: currentUser,
      content: text,
      skill: currentSkill,
      roomId: roomId,
      timestamp: new Date().toISOString()
    };

    console.log("📤 Sending message:", chatMessage);
    console.log("📤 To destination:", `/app/chat/${roomId}`);

    try {
      stompClient.publish({
        destination: `/app/chat/${roomId}`,
        body: JSON.stringify(chatMessage),
        headers: {
          'content-type': 'application/json'
        }
      });

      console.log("✅ Message published successfully");
      setText("");
    } catch (err) {
      console.error("❌ Error sending message:", err);
      alert("Failed to send message. Please try again.");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const uploadFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFiles(prev => [...prev, file]);

    if (stompClient && stompClient.connected) {
      stompClient.publish({
        destination: `/app/chat/${roomId}`,
        body: JSON.stringify({
          sender: currentUser,
          content: `📎 Shared file: ${file.name}`,
          skill: currentSkill,
          roomId: roomId,
          timestamp: new Date().toISOString(),
          isFile: true,
          fileName: file.name
        })
      });
    }

    e.target.value = '';
  };

  const startVideoCall = () => {
    const meetLink = "https://meet.google.com/new";
    window.open(meetLink, '_blank');

    if (stompClient && stompClient.connected) {
      stompClient.publish({
        destination: `/app/chat/${roomId}`,
        body: JSON.stringify({
          sender: currentUser,
          content: `📹 Join video call: ${meetLink}`,
          skill: currentSkill,
          roomId: roomId,
          timestamp: new Date().toISOString()
        })
      });
    }
  };

  const goBack = () => {
    localStorage.removeItem("peerName");
    localStorage.removeItem("currentSkill");
    navigate('/requests');
  };

  // Styles
  const styles = {
    container: {
      display: 'grid',
      gridTemplateColumns: '300px 1fr',
      height: '100vh',
      background: '#f0f2f5'
    },
    sidebar: {
      background: '#fff',
      borderRight: '1px solid #e0e0e0',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column'
    },
    mainChat: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#fff'
    },
    header: {
      padding: '20px',
      borderBottom: '1px solid #e0e0e0',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      gap: '15px'
    },
    backButton: {
      background: 'none',
      border: 'none',
      fontSize: '20px',
      cursor: 'pointer',
      color: '#4f46e5',
      padding: '8px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    headerInfo: {
      flex: 1
    },
    peerName: {
      fontSize: '18px',
      fontWeight: '600',
      margin: 0,
      color: '#1a1a1a'
    },
    skillName: {
      fontSize: '14px',
      color: '#666',
      margin: '4px 0 0 0'
    },
    connectionStatus: {
      fontSize: '12px',
      padding: '4px 8px',
      borderRadius: '12px',
      background: connected ? '#22c55e20' : '#ef444420',
      color: connected ? '#22c55e' : '#ef4444',
      display: 'inline-block'
    },
    messagesArea: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px',
      background: '#f8fafc',
      display: 'flex',
      flexDirection: 'column'
    },
    messageBubble: {
      maxWidth: '65%',
      marginBottom: '15px',
      padding: '12px 16px',
      borderRadius: '18px',
      position: 'relative',
      wordWrap: 'break-word'
    },
    myMessage: {
      alignSelf: 'flex-end',
      background: '#4f46e5',
      color: '#fff',
      borderBottomRightRadius: '4px'
    },
    otherMessage: {
      alignSelf: 'flex-start',
      background: '#fff',
      color: '#1a1a1a',
      borderBottomLeftRadius: '4px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
    },
    senderName: {
      fontSize: '12px',
      fontWeight: '600',
      marginBottom: '4px',
      color: '#666'
    },
    messageContent: {
      fontSize: '14px',
      lineHeight: '1.4'
    },
    timestamp: {
      fontSize: '10px',
      marginTop: '4px',
      opacity: 0.7,
      textAlign: 'right'
    },
    inputArea: {
      padding: '20px',
      borderTop: '1px solid #e0e0e0',
      background: '#fff',
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    },
    input: {
      flex: 1,
      padding: '12px 16px',
      border: '1px solid #e0e0e0',
      borderRadius: '24px',
      fontSize: '14px',
      outline: 'none'
    },
    sendButton: {
      background: '#4f46e5',
      color: '#fff',
      border: 'none',
      width: '45px',
      height: '45px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      opacity: !connected || !text.trim() ? 0.5 : 1
    },
    errorContainer: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      padding: '20px',
      textAlign: 'center'
    },
    loadingContainer: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontSize: '18px',
      color: '#666'
    }
  };

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <h2 style={{ color: '#ef4444', marginBottom: '20px' }}>Error</h2>
        <p style={{ marginBottom: '30px', color: '#666' }}>{error}</p>
        <button
          onClick={goBack}
          style={{
            padding: '12px 24px',
            background: '#4f46e5',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Go Back to Requests
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        Loading chat session...
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <h2 style={{ marginBottom: '20px', color: '#1a1a1a' }}>Learning Session</h2>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#666' }}>SKILL</label>
          <p style={{ fontSize: '18px', fontWeight: '600', margin: '5px 0' }}>{currentSkill}</p>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#666' }}>LEARNING PARTNER</label>
          <p style={{ fontSize: '16px', fontWeight: '500', margin: '5px 0' }}>
            {peerUser || 'Loading...'}
          </p>
        </div>

        <div style={{ marginBottom: '30px' }}>
          <span style={styles.connectionStatus}>
            {connected ? '● Connected' : '○ Connecting...'}
          </span>
        </div>

        <h3 style={{ marginBottom: '15px', fontSize: '16px' }}>Resources</h3>

        <button
          onClick={startVideoCall}
          style={{
            width: '100%',
            padding: '12px',
            background: '#f8fafc',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px',
            fontSize: '14px'
          }}
        >
          <FaVideo /> Start Video Call
        </button>

        <div style={{ marginTop: '10px' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={uploadFile}
            style={{ display: 'none' }}
            accept=".pdf,.doc,.docx,.txt,.jpg,.png"
          />
          <button
            onClick={() => fileInputRef.current.click()}
            style={{
              width: '100%',
              padding: '12px',
              background: '#f8fafc',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '14px'
            }}
          >
            <FaFile /> Share File
          </button>
        </div>

        {files.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '10px' }}>Shared Files:</h4>
            {files.map((file, index) => (
              <div key={index} style={{ fontSize: '12px', padding: '5px 0', color: '#666' }}>
                📎 {file.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div style={styles.mainChat}>
        {/* Header */}
        <div style={styles.header}>
          <button onClick={goBack} style={styles.backButton}>
            <FaArrowLeft />
          </button>
          <div style={styles.headerInfo}>
            <h3 style={styles.peerName}>{peerUser || 'Partner'}</h3>
            <p style={styles.skillName}>Learning: {currentSkill}</p>
          </div>
        </div>

        {/* Messages */}
        <div style={styles.messagesArea} ref={chatRef}>
          {messages.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#666',
              marginTop: '40px',
              fontSize: '14px'
            }}>
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((msg, index) => {
              if (!msg || !msg.sender) return null;
              const isMe = msg.sender === currentUser;

              return (
                <div
                  key={index}
                  style={{
                    ...styles.messageBubble,
                    ...(isMe ? styles.myMessage : styles.otherMessage)
                  }}
                >
                  {!isMe && (
                    <div style={styles.senderName}>{msg.sender}</div>
                  )}
                  <div style={styles.messageContent}>
                    {msg.content}
                  </div>
                  <div style={styles.timestamp}>
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input Area */}
        <div style={styles.inputArea}>
          <input
            style={styles.input}
            type="text"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!connected}
          />
          <button
            style={styles.sendButton}
            onClick={sendMessage}
            disabled={!connected || !text.trim()}
          >
            <FaPaperPlane />
          </button>
        </div>
      </div>
    </div>
  );
}