<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'php/vendor/autoload.php';
require 'phpmailer/phpmailer/src/Exception.php';
require 'phpmailer/phpmailer/src/PHPMailer.php';
require 'phpmailer/phpmailer/src/SMTP.php';

// Load .env file
$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#')) continue;
        [$key, $value] = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($value);
    }
}

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $name    = $_POST["name"];
    $email   = $_POST["email"];
    $message = $_POST["message"];

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        die("Invalid email address.");
    }

    $mail = new PHPMailer(true);

    try {
        $mail->SMTPDebug = 0;
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = $_ENV['SMTP_USER'];
        $mail->Password   = $_ENV['SMTP_PASS'];
        $mail->SMTPSecure = 'tls';
        $mail->Port       = 587;

        $mail->setFrom($email, $name);
        $mail->addAddress($_ENV['SMTP_TO']);

        // Content
        $mail->isHTML(true);                                  // Set email format to HTML
        $mail->Subject = 'New Contact Form Submission';
        $mail->Body    = "Name: $name\nEmail: $email\n\nMessage:\n$message";

        $mail->send();
        echo 'Message has been sent';
    } catch (Exception $e) {
        echo "Message could not be sent. Mailer Error: {$mail->ErrorInfo}";
    }
}

