Pod::Spec.new do |s|
  s.name         = 'BidwisePush'
  s.version      = '1.0.0'
  s.summary      = 'APNs token, permission, foreground and tap events for Bidwise.'
  s.description  = 'Registers for remote notifications, hands the raw APNs device token to ' \
                   'JavaScript, shows notifications in the foreground and reports taps, ' \
                   'including the tap that launched the app.'
  s.homepage     = 'https://161.118.170.233.sslip.io'
  s.license      = { :type => 'Proprietary', :text => 'Bidwise' }
  s.author       = 'Bidwise'
  s.platforms    = { :ios => '15.5' }
  s.source       = { :path => '.' }
  s.source_files = '*.{h,mm}'
  s.public_header_files = 'BidwisePush.h'
  s.frameworks   = 'UserNotifications', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency 'React-Core'
  end
end
