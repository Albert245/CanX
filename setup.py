from setuptools import setup, Extension, find_packages
from Cython.Build import cythonize

ext_modules = cythonize(
    [
        Extension(
            name="E2E.CRC.crc_cy",
            sources=["E2E/CRC/crc_cy.pyx"],
            language="c",
        )
    ],
    compiler_directives={
        "language_level": 3,
        "boundscheck": False,
        "wraparound": False,
        "nonecheck": False,
        "cdivision": True,
    },
)

setup(
    name="CanX",
    version="0.1.0",
    packages=find_packages(include=["E2E", "E2E.*"]),
    ext_modules=ext_modules,
    include_package_data=True,
)
