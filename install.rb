#! /usr/bin/ruby

home = ENV['HOME']

Dir.glob('*').each do |fn|
    next if fn =~ /~$/

    basename = if fn == 'bin'
        fn
    else
        ".#{fn}"
    end
    dest = home + '/' + basename

    if File.exists?(dest)
        if File.symlink?(dest)
            File.unlink(dest)
        else
            next
        end
    end
    
    File.symlink(File.absolute_path(fn), dest)
end
