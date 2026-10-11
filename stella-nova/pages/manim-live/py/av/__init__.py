"""av -- an import-time stand-in for PyAV (FFmpeg bindings).

Why this module exists
----------------------
PyAV is a Cython binding to FFmpeg. A browser cannot load it. Manim imports
``av`` at module level in scene_file_writer.py, video_segment_encoder.py,
_config/video_encoder.py and utils/commands.py. manim-live runs every scene
with ``config.format = "none"``: manim's real SceneFileWriter then encodes
nothing, and the runtime takes each frame from SceneFileWriter.write_frame
and streams it to the page (see manimlive/runtime.py). So no PyAV function
runs. Every entry point here raises a clear error if user code calls it.

The page exports video in the browser from the streamed frames
(MediaRecorder / WebCodecs), not with FFmpeg.
"""

__version__ = "0.0.0+manim-live-stub"

_MSG = (
    "manim-live: PyAV (FFmpeg) is not available in the browser. Manim renders "
    "with format='none' and the page receives the frames directly."
)


class AVError(Exception):
    pass


class FFmpegError(AVError):
    pass


def open(*args, **kwargs):  # noqa: A001 - same name as PyAV
    raise AVError(_MSG)


class VideoFrame:
    @staticmethod
    def from_ndarray(*args, **kwargs):
        raise AVError(_MSG)


class AudioFrame:
    @staticmethod
    def from_ndarray(*args, **kwargs):
        raise AVError(_MSG)


class VideoFormat:
    def __init__(self, *args, **kwargs):
        raise AVError(_MSG)


class _Namespace:
    def __init__(self, **items):
        self.__dict__.update(items)


class _Codec:
    def __init__(self, *args, **kwargs):
        raise ValueError(_MSG)


class _ContainerFormat:
    def __init__(self, *args, **kwargs):
        raise ValueError(_MSG)


class _Graph:
    def __init__(self, *args, **kwargs):
        raise AVError(_MSG)


class _EOFError(AVError, EOFError):
    pass


codec = _Namespace(Codec=_Codec)
format = _Namespace(ContainerFormat=_ContainerFormat)  # noqa: A001
filter = _Namespace(Graph=_Graph)  # noqa: A001
error = _Namespace(EOFError=_EOFError, FFmpegError=FFmpegError)
