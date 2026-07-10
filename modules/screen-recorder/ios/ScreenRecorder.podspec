Pod::Spec.new do |s|
  s.name           = 'ScreenRecorder'
  s.version        = '1.0.0'
  s.summary        = 'ReplayKit in-app screen recorder for TWK Participate'
  s.description    = 'Records the TWK Participate test session using ReplayKit with explicit user consent.'
  s.author         = 'TawakkalnaOS'
  s.homepage       = 'https://test.tawakkalnaos.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.license        = { :type => 'MIT' }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
