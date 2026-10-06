from flask import Flask, request, jsonify, render_template_string
import json
import os

app = Flask(__name__)
DATA_FILE = "current_infra.json"

@app.route('/api/update', methods=['POST'])
def update_infra():
    data = request.json
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)
    return jsonify({"status": "success", "message": "Dashboard updated!"})

@app.route('/api/data', methods=['GET'])
def get_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            return jsonify(json.load(f))
    return jsonify({})

@app.route('/')
def dashboard():
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Prodpai Cloud - Status</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script type="module">
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
            mermaid.initialize({ startOnLoad: false, theme: 'dark' });

            async function loadData() {
                try {
                    const res = await fetch('/api/data');
                    const data = await res.json();
                    
                    if (Object.keys(data).length === 0) {
                        document.getElementById('diagram').innerHTML = "Waiting for Terraform CI/CD to send data...";
                        return;
                    }

                    document.getElementById('update-time').innerText = data.update_time || new Date().toLocaleString();
                    
                    // สร้าง Diagram จัดเต็มทั้ง SG, Health Check และสถานะ Terminated
                    const graphDef = `
                    graph TD
                        Internet([🌐 Internet]) --> WAF{🛡️ AWS WAF<br/>${data.waf.name}}
                        
                        WAF --> ALB[⚖️ App Load Balancer<br/>${data.load_balancer.dns_name}<br/><br/>🛡️ SG: ${data.security_groups.alb}]
                        
                        ALB --> TG((🎯 Target Group: ${data.target_group.name}<br/>❤️ Health Check: HTTP ${data.target_group.health_check_port} ${data.target_group.health_check_path}<br/>✅ Expect: ${data.target_group.health_check_matcher}))
                        
                        TG --> ASG[[⚙️ Auto Scaling Group<br/>${data.auto_scaling.name}<br/>Capacity: ${data.auto_scaling.desired_capacity}]]
                        
                        subgraph VPC [☁️ AWS VPC: ${data.vpc.id}]
                            ASG --> EC2_1((💻 Active EC2<br/>🛡️ SG: ${data.security_groups.instance}))
                            ASG --> EC2_2((💻 Active EC2<br/>🛡️ SG: ${data.security_groups.instance}))
                            
                            Builder[/🛠️ Image Builder<br/>ID: ${data.image_builder.instance_id}<br/>AMI: ${data.image_builder.ami_id}<br/><br/>☠️ Status: Terminated /]
                        end
                        
                        CloudWatch((📊 CloudWatch)) -.->|Alert| Lambda[⚡ Lambda SecOps<br/>${data.security.lambda_quarantine}]
                        
                        Lambda -.->|Modify Attribute| Q_SG[🔒 Air-Gap SG<br/>${data.security_groups.quarantine}]
                        Q_SG -.->|Isolate| EC2_1
                    `;
                    
                    const diagramContainer = document.getElementById('diagram');
                    diagramContainer.innerHTML = graphDef;
                    document.getElementById('diagram').removeAttribute('data-processed');
                    await mermaid.run({ nodes: [diagramContainer] });
                } catch (error) {
                    console.error("Error loading data:", error);
                }
            }

            setInterval(loadData, 5000);
            loadData();
        </script>
    </head>
    <body class="bg-gray-900 text-white font-sans p-8 min-h-screen">
        <div class="max-w-5xl mx-auto">
            <h1 class="text-4xl font-bold text-blue-400 mb-2">☁️ Prodpai Cloud Infrastructure</h1>
            <p class="text-gray-400 mb-8">Last Terraform Apply: <span id="update-time" class="text-green-400 font-mono">Loading...</span></p>
            
            <div class="bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700 overflow-x-auto">
                <div id="diagram" class="flex justify-center text-lg">
                    Loading Architecture Diagram...
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    return render_template_string(html_content)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)