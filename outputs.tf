output "ssh_command" {
  value       = "ssh -i C:/Users/nunta/.ssh/prod-pai-key.pem ubuntu@${aws_instance.web.public_ip}"
  description = "Command for SSH into ubuntu"
}
