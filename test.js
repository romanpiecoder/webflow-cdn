// test.js
(function() {
    console.log("RomanPie test script loaded ✅");
  
    // Find button with ID #testBtn
    document.addEventListener("DOMContentLoaded", function() {
      const btn = document.getElementById("testBtn");
      if (!btn) return;
  
      btn.addEventListener("click", async () => {
        console.log("Button clicked, sending webhook...");
  
        try {
          const res = await fetch("https://YOUR-N8N-URL/webhook/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "Hello from Webflow -> CDN -> n8n" })
          });
  
          const text = await res.text();
          console.log("Webhook response:", text);
          alert("Webhook sent! Check n8n logs.");
        } catch (err) {
          console.error("Error sending webhook", err);
        }
      });
    });
  })();
  