# Runs ON the dashboard EC2 through SSM (as root); update-code.sh sets INFRA_REPO and INFRA_REF above this line.
# Pulls the dashboard from this repository into /opt/prodpai and points the service at it.
set -e

if [ -d /opt/prodpai/.git ]; then
  git -C /opt/prodpai fetch --depth 1 origin "$INFRA_REF"
  git -C /opt/prodpai reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$INFRA_REF" "https://github.com/$INFRA_REPO.git" /opt/prodpai
fi
chown -R ubuntu:ubuntu /opt/prodpai/dashboard

[ -x /opt/venv/bin/pip ] || python3 -m venv /opt/venv
/opt/venv/bin/pip install -q -r /opt/prodpai/dashboard/requirements.txt

sed -i -e 's#^WorkingDirectory=.*#WorkingDirectory=/opt/prodpai/dashboard#' \
       -e 's#^ExecStart=.*#ExecStart=/opt/venv/bin/gunicorn dashboard_app:app#' \
       /etc/systemd/system/prodpai-dashboard.service
systemctl daemon-reload
systemctl restart prodpai-dashboard

git -C /opt/prodpai log -1 --format='dashboard at %h %s'
