class Ril < Formula
  desc "Open language and control plane for proving and governing what AI does"
  homepage "https://github.com/retvest/RIL"
  version "0.3.0"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/retvest/RIL/releases/download/v#{version}/ril-aarch64-apple-darwin.tar.gz"
      sha256 "REPLACE_WITH_ARM64_DARWIN_SHA256"
    else
      url "https://github.com/retvest/RIL/releases/download/v#{version}/ril-x86_64-apple-darwin.tar.gz"
      sha256 "REPLACE_WITH_X86_64_DARWIN_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/retvest/RIL/releases/download/v#{version}/ril-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_WITH_ARM64_LINUX_SHA256"
    else
      url "https://github.com/retvest/RIL/releases/download/v#{version}/ril-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_WITH_X86_64_LINUX_SHA256"
    end
  end

  def install
    bin.install "ril"
  end

  test do
    assert_match "RIL v3 Language Grammar", shell_output("#{bin}/ril spec")
  end
end
