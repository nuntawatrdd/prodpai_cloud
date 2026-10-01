output "ssh_command" {
  value       = "ssh -i C:/Users/nunta/.ssh/prod-pai-key.pem ubuntu@${aws_instance.web.public_ip}"
  description = "Command for SSH into ubuntu"
}

output "public_ip" {
  value = aws_instance.web.public_ip
}

output "web_url" {
  value = "http://${aws_instance.web.public_dns}"
}
