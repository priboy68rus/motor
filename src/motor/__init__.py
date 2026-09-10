"""motor report compiler."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("motor-reports")
except PackageNotFoundError:
    __version__ = "0+unknown"
